import {ServiceType} from "@protobuf-ts/runtime-rpc";
import express from "express";
import http from "http";
import {getHttpRule, parseHttpRule} from "../shared/google_api_http";

// @ts-ignore
import morgan from "morgan";
import {Logger, printServerUrls} from "./logger";

/// Client used to define mocks
export type MockServerCallContext = {};

export type DefineMockOptions = DefineServiceOptions | DefineServiceOptions[];

export type DefineServiceOptions = {
  type: ServiceType;
  service: () => Service;
  prefix?: string;
};

export function validateDefineServiceOptions(
  opts: unknown
): DefineServiceOptions {
  const throwError = (msg: string): never => {
    throw new Error("invalid DefineMockOptions: " + msg);
  };

  if (typeof opts !== "object") {
    throwError(`require service to be object`);
  }

  const nopts = opts as Record<string, unknown>;

  if (typeof nopts.type !== "object") {
    throwError(
      `require service.type to be ServiceType, got ${typeof nopts.type}`
    );
  }

  if (typeof nopts.service !== "function") {
    throwError(`require service.service to be function`);
  }

  return nopts as unknown as DefineServiceOptions;
}

export function validateDefineMockOptions(opts: unknown): MockOptions {
  if (Array.isArray(opts)) {
    const services = opts.map((v) => validateDefineServiceOptions(v));
    return {services};
  }

  return {
    services: [validateDefineServiceOptions(opts)],
  };
}

export function defineMocks(options: DefineMockOptions): DefineMockOptions {
  return options;
}

// Mock Manager
export type MockOptions = {
  services: DefineServiceOptions[];
};

export type Service = object;
type ServiceFunction = (
  req: unknown,
  context: MockServerCallContext
) => Promise<unknown>;

interface MockModule {
  id: string;
  services: Service[];
  opts: MockOptions;
}

interface ServiceItem {
  type: ServiceType;
  service: Service;
  prefix: string;
}

export class MockManager {
  private servicesSet: Set<ServiceType> = new Set();
  private mockModules: Map<string, MockModule> = new Map();

  constructor(private logger: Logger) {}

  addMock(moduleId: string, opts: MockOptions) {
    if (this.mockModules.has(moduleId)) {
      this.logger.warn(
        `Module ${moduleId} already registered, we will removed it first`
      );
      this.mockModules.delete(moduleId);
    }

    for (let i = 0; i < opts.services.length; i++) {
      const svcOpt = opts.services[i];
      if (this.servicesSet.has(svcOpt.type)) {
        this.logger.warn(
          `Service ${svcOpt.type.typeName} already registered, we will add it again`
        );
      }

      this.servicesSet.add(svcOpt.type);
    }

    const services = opts.services.map((svcOpt) => svcOpt.service());
    this.mockModules.set(moduleId, {
      id: moduleId,
      services,
      opts,
    });

    return this;
  }

  removeMock(moduleId: string) {
    const module = this.mockModules.get(moduleId);
    if (!module) {
      return;
    }
    this.mockModules.delete(moduleId);

    for (let i = 0; i < module.services.length; i++) {
      const svcOpt = module.opts.services[i];
      this.servicesSet.delete(svcOpt.type);
    }
  }

  getServices(): ServiceItem[] {
    let res: ServiceItem[] = [];

    for (const module of this.mockModules.values()) {
      for (let i = 0; i < module.services.length; i++) {
        const svcOpt = module.opts.services[i];
        res.push({
          service: module.services[i],
          type: svcOpt.type,
          prefix: svcOpt.prefix || "",
        });
      }
    }

    return res;
  }
}

export type MockServerOptions = {
  prefix?: string;
  port?: number;
  host?: string;
};

export class MockServer {
  private opts: Required<MockServerOptions>;
  private express: express.Express;
  private server: http.Server | undefined;

  constructor(
    private logger: Logger,
    opts: MockServerOptions,
    services: ServiceItem[]
  ) {
    this.opts = {
      prefix: opts.prefix || "/",
      port: opts.port || 18877,
      host: opts.host || "127.0.0.1",
    };

    this.express = express();
    this.express.use(express.json());
    this.express.use((err: any, _req: any, res: any, next: any) => {
      if (typeof err === "object") {
        logger.error(`request error: ${err}`, err);
      }
      res.status(500).send(JSON.stringify(err));
    });
    // requests logger, @see https://github.com/expressjs/morgan
    this.express.use(morgan("combined"));

    // routers
    const router = express.Router();
    this.express.use(this.opts.prefix, router);

    const subRoutersByPrefix: Map<string, express.Router> = new Map();
    const getSubRouter = (prefix: string): express.Router => {
      let subRouter = subRoutersByPrefix.get(prefix);
      if (!subRouter) {
        subRouter = express.Router();
        router.use(prefix, subRouter);
        subRoutersByPrefix.set(prefix, subRouter);
      }
      return subRouter;
    };

    // register services

    for (const svc of services) {
      const subRouter = getSubRouter(svc.prefix);
      for (const method of svc.type.methods) {
        let handler = (svc.service as Record<string, ServiceFunction>)[
          method.localName
        ];
        if (!handler) {
          throw new Error(
            `Service ${svc.type.typeName} is missing method ${method.localName}`
          );
        }

        handler = handler.bind(svc.service);

        const httpRule = parseHttpRule(getHttpRule(method.options));
        subRouter.post(httpRule.post, async function (req, res, next) {
          try {
            const input = method.I.fromJson(req.body);
            const output = await handler(input, {});
            res.send(method.O.toJson(output));
          } catch (e) {
            next(e);
          }
        });
      }
    }
  }

  async start(params: {logStart: boolean}) {
    const opts = this.opts;
    const server = this.express.listen(opts.port, opts.host, () => {
      let url = `http://${opts.host}:${opts.port}${opts.prefix}`;

      if (params.logStart) {
        this.logger.info("Mock server started");
        printServerUrls(
          {
            local: [`http://127.0.0.1:${opts.port}${opts.prefix}`],
            network: opts.host.startsWith("0") ? [url] : [],
          },
          false,
          this.logger.info
        );
      }
    });

    this.server = server;

    await new Promise((resolve, reject) => {
      server.on("error", reject);
      server.on("close", resolve);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) {
      throw new Error(`server not start`);
    }

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export type ReloadRunParams = {
  firstRun: boolean;
};
export type ReloadFactory = () => {
  run: (p: ReloadRunParams) => Promise<void>;
  close: () => Promise<void>;
};

export function withReload(facotry: ReloadFactory): {
  runForever: () => Promise<void>;
  reload: () => Promise<void>;
  stop: () => Promise<void>;
} {
  let ctx = {
    firstRun: true,
    isStopped: false,
    close: async () => {},
  };

  const run = async (): Promise<void> => {
    while (true) {
      const res = facotry();
      ctx.close = res.close;
      await res.run({
        firstRun: ctx.firstRun,
      });
      ctx.firstRun = false;

      if (ctx.isStopped) {
        break;
      }
    }
  };

  return {
    runForever: run,
    reload: async () => ctx.close(),
    stop: async () => {
      ctx.isStopped = true;
      await ctx.close();
    },
  };
}

export interface ResolvedServerUrls {
  local: string[];
  network: string[];
}
