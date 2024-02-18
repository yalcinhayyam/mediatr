import "reflect-metadata";
import {
  IAuthorized,
  INotification,
  INotificationHandler,
  IPipelineBehavior,
  IRequest,
  IRequestHandler,
  Mediator,
  PipelineBehavior,
  RequestHandler,
  UsePipelineBehavior,
  NotificationHandler,
  IMediator,
} from "./utilities";
import { autoInjectable, injectable } from "tsyringe";

interface IDateTimeProvider {
  get utcNow(): Date;
}

// @injectable()
class DateTimeProvider implements IDateTimeProvider {
  get utcNow(): Date {
    return new Date(Date.now());
  }
}

@PipelineBehavior(false)
@injectable()
export class AuthorizedPipelineBehavior<
  TRequest extends IRequest<unknown> & IAuthorized,
  TResponse
> implements IPipelineBehavior<TResponse>
{
  constructor(
    // @inject(DateTimeProvider)
    private readonly _dateTimeProvider: DateTimeProvider
  ) {}
  async handle(
    request: TRequest,
    next: () => Promise<TResponse>
  ): Promise<TResponse> {
    console.log(request.session.user);
    const result = await next();
    console.log({ result });
    return result;
  }
}

@UsePipelineBehavior(AuthorizedPipelineBehavior)
export class CreateProductCommand implements IRequest<number>, IAuthorized {
  public constructor(readonly title: string) {}
  session: { readonly user: Readonly<{ readonly name: string }> } = {
    user: { name: "admin" },
  };
}

@RequestHandler(CreateProductCommand)
@autoInjectable()
class CreateProductCommandHandler
  implements IRequestHandler<CreateProductCommand, number>
{
  constructor(
    // @inject(DateTimeProvider)
    private readonly _dateTimeProvider: DateTimeProvider
  ) {}
  handle(value: CreateProductCommand): Promise<number> {
    console.log(value.title, this._dateTimeProvider.utcNow);
    return Promise.resolve(10);
  }
}

class ProductCreatedNotification implements INotification {
  constructor(readonly title: string, readonly date: Date) {}
}

@NotificationHandler(ProductCreatedNotification)
@injectable()
class ProductCreatedNotificationHandler
  implements INotificationHandler<ProductCreatedNotification>
{
  constructor(
    // @inject(DateTimeProvider)
    private readonly _dateTimeProvider: DateTimeProvider
  ) {}
  handle(notification: ProductCreatedNotification): Promise<void> {
    console.log(notification, this.constructor.name);

    return Promise.resolve();
  }
}

@NotificationHandler(ProductCreatedNotification)
class ProductCreatedOtherNotificationHandler
  implements INotificationHandler<ProductCreatedNotification>
{
  handle(notification: ProductCreatedNotification): Promise<void> {
    console.log(notification, this.constructor.name);
    return Promise.resolve();
  }
}

const mediator: IMediator = new Mediator();
mediator
  .send<number>(new CreateProductCommand("Example Product"))
  .then((res) => {
    console.log(res);
    mediator.publish(
      new ProductCreatedNotification("Example Product", new Date())
    );
  });
