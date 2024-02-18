import { container } from "tsyringe";

 const injector = container


export class MediatorConfiguration {
  private _pipelineBehaviors: (RegistryPipelineBehaviorType<any> & {
    requests: IRequestClass<any>[];
  })[] = [];
  private _notifications: RegistryNotificationType[] = [];

  constructor(public readonly resolver: IResolver) {}

  notifications(): readonly RegistryNotificationType[] {
    return this._notifications;
  }

  pipelineBehaviors<T>(): readonly (RegistryPipelineBehaviorType<T> & {
    requests: IRequestClass<T>[];
  })[] {
    return this._pipelineBehaviors;
  }

  registerNotification(configuration: RegisterNotificationType): void {
    const registeredNotification = this._notifications.find(
      (notification) => notification.message.name === configuration.message.name
    );

    if (registeredNotification) {
      if (
        !registeredNotification.notifications.some(
          (existingNotification) =>
            existingNotification.name === configuration.notification.name
        )
      ) {
        registeredNotification.notifications.push(configuration.notification);
      }
    } else {
      this._notifications.push({
        message: configuration.message,
        notifications: [configuration.notification],
      });
    }
  }

  usePipelineBehavior<T>(
    pipelineBehavior: IPipelineBehaviorClass<T>,
    target: IRequestClass<T>
  ): void {
    const retrievedPb = this.pipelineBehaviors().find(
      (pb) => pb.pipelineBehavior.name == pipelineBehavior.name
    );

    if (retrievedPb!.autoRegister) {
      throw new Error(
        `The pipeline behavior ${pipelineBehavior.name} auto register enabled !`
      );
    }
    retrievedPb?.requests.push(target);
  }

  removeNotification(configuration: RegisterNotificationType): void {
    const index = this._notifications.findIndex(
      (notification) => notification.message.name === configuration.message.name
    );

    if (index !== -1) {
      this._notifications.splice(index, 1);

      const requestIndex = this._notifications.findIndex(
        (notification) =>
          notification.message.name === configuration.message.name
      );

      if (requestIndex !== -1) {
        this._notifications.splice(requestIndex, 1);
      }
    }
  }

  registerPipelineBehavior<T>(
    configuration: RegistryPipelineBehaviorType<T>
  ): void {
    if (
      this._pipelineBehaviors.some(
        (pb) => pb.pipelineBehavior.name == configuration.pipelineBehavior.name
      )
    )
      return;
    this._pipelineBehaviors.push({ ...configuration, requests: [] });
  }

  removePipelineBehavior<T>(
    configuration: RegistryPipelineBehaviorType<T>
  ): void {
    this._pipelineBehaviors = this._pipelineBehaviors.filter(
      (behavior) =>
        behavior.pipelineBehavior.name !== configuration.pipelineBehavior.name
    );
  }
}

class TsyringeResolver implements IResolver {
  resolve<T>(token: string | Constructor<T>): T {
    return injector.resolve(token);
  }
  register<T>(token: string | Constructor<T>, instance: Constructor<T>): void {
    injector.register(token, instance);
  }
  remove<T>(token: string | Constructor<T>): void {
    throw new Error("Tsyringe not support remove function");
  }
  clear(): void {
    injector.reset();
  }
}

const _mediatorConfiguration = new MediatorConfiguration(
  new TsyringeResolver()
);

export type Constructor<T> = {
  new (args: any[]): T;
};
export interface IResolver {
  resolve<T>(token: string | Constructor<T>): T;
  register<T>(token: string | Constructor<T>, instance: Constructor<T>): void;
  remove<T>(token: string | Constructor<T>): void;
  clear(): void;
}

export interface IMediator {
  send<T>(request: IRequest<T>): Promise<T>;
  publish(message: INotification): Promise<void>;
}

export interface IRequest<T> {
  constructor: Function;
}

export interface INotificationHandler<T> {
  handle(message: T): Promise<void>;
}

export type INotificationHandlerClass<T> = new (
  ...args: unknown[]
) => INotificationHandler<T>;

export type IRequestClass<T> = new (...args: any[]) => IRequest<T>;

export interface IRequestHandler<TRequest, TResponse> {
  handle(request: TRequest): Promise<TResponse>;
}

export interface INotification {
  constructor: Function;
}

export type INotificationClass = new (...args: any[]) => INotification;

export type IPipelineBehaviorClass<T> = new (
  ...args: any[]
) => IPipelineBehavior<T>;

export class Mediator implements IMediator {
  public async send<T>(request: IRequest<T>): Promise<T> {
    const name = request.constructor.name;
    const handler =
      _mediatorConfiguration.resolver.resolve<IRequestHandler<IRequest<T>, T>>(
        name
      );

    const runBehaviors = async (
      remainingBehaviors: readonly (RegistryPipelineBehaviorType<T> & {
        requests: IRequestClass<T>[];
      })[]
    ): Promise<T> => {
      if (remainingBehaviors.length == 0) return handler.handle(request);
      const [currentBehavior, ...restBehaviors] = remainingBehaviors;
      if (
        currentBehavior!.autoRegister ||
        currentBehavior?.requests.some(
          (r) => r.name == request.constructor.name
        )
      ) {
        return _mediatorConfiguration.resolver
          .resolve(currentBehavior!.pipelineBehavior)
          .handle(request, async () => {
            return await runBehaviors(restBehaviors);
          });
      }
      return await runBehaviors(restBehaviors);
    };

    return await runBehaviors(_mediatorConfiguration.pipelineBehaviors<T>());
  }

  public async publish(message: INotification): Promise<void> {
    const events = _mediatorConfiguration
      .notifications()
      .find(
        (request) => request.message.name == message.constructor.name
      )!.notifications;

    await Promise.all(
      events.map(async (p) => {
        return _mediatorConfiguration.resolver.resolve(p).handle(message);
      })
    );
  }
}

export const PipelineBehavior = <T>(
  config:
    | boolean
    | {
        autoRegister: boolean;
      }
) => {
  return (target: IPipelineBehaviorClass<T>): void => {
    _mediatorConfiguration.registerPipelineBehavior({
      pipelineBehavior: target,
      autoRegister: typeof config === "boolean" ? config : config.autoRegister,
    });
  };
};

export function UsePipelineBehavior<T>(
  pipelineBehavior: IPipelineBehaviorClass<T>
) {
  return (target: Function): void => {
    _mediatorConfiguration.usePipelineBehavior(
      pipelineBehavior,
      target.prototype.constructor
    );
  };
}

export const RequestHandler = <T>(value: IRequestClass<T>) => {
  return (target: Function): void => {
    _mediatorConfiguration.resolver.register(
      value.name,
      target.prototype.constructor
    );
  };
};

export const NotificationHandler = (value: INotificationClass) => {
  return (target: Function): void => {
    _mediatorConfiguration.registerNotification({
      message: value,
      notification: target as any,
    });
  };
};

export type RegistryPipelineBehaviorType<T> = {
  autoRegister: boolean;
  pipelineBehavior: IPipelineBehaviorClass<T>;
};

export type RegistryNotificationType = {
  message: INotificationClass;
  notifications: INotificationHandlerClass<INotification>[];
};

export type RegisterNotificationType = {
  message: INotificationClass;
  notification: INotificationHandlerClass<INotification>;
};

export type New = new () => any;
export interface IAuthorized {
  readonly session: {
    readonly user: Readonly<{ readonly name: string }>;
  };
}

export interface IPipelineBehavior<TResponse> {
  handle(
    request: IRequest<TResponse>,
    next: () => Promise<TResponse>
  ): Promise<TResponse>;
}
