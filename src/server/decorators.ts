import type { Express, Request, RequestHandler, Response } from 'express';

type HttpMethod = 'get';

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlerName: string | symbol;
}

const controllerPaths = new WeakMap<Function, string>();
const routeDefinitions = new WeakMap<Function, RouteDefinition[]>();

function joinPaths(basePath: string, routePath: string): string {
  const cleanBase = `/${basePath}`.replace(/\/+/g, '/').replace(/\/$/, '');
  const cleanRoute = `/${routePath}`.replace(/\/+/g, '/');
  const joined = `${cleanBase}${cleanRoute === '/' ? '' : cleanRoute}`.replace(/\/+/g, '/');
  return joined === '' ? '/' : joined;
}

export function Controller(path = ''): ClassDecorator {
  return (target) => {
    controllerPaths.set(target, path);
  };
}

export function Get(path = ''): MethodDecorator {
  return (target, propertyKey) => {
    const constructor = target.constructor;
    const routes = routeDefinitions.get(constructor) ?? [];
    routes.push({ method: 'get', path, handlerName: propertyKey });
    routeDefinitions.set(constructor, routes);
  };
}

export function registerControllers(app: Express, controllers: object[]): void {
  for (const controller of controllers) {
    const constructor = controller.constructor;
    const basePath = controllerPaths.get(constructor) ?? '';
    const routes = routeDefinitions.get(constructor) ?? [];

    for (const route of routes) {
      const handler = (controller as Record<string | symbol, unknown>)[route.handlerName];
      if (typeof handler !== 'function') {
        throw new Error(`Controller handler ${String(route.handlerName)} is not a function`);
      }

      app[route.method](joinPaths(basePath, route.path), handler.bind(controller) as RequestHandler);
    }
  }
}

export type ControllerRequest = Request;
export type ControllerResponse = Response;
