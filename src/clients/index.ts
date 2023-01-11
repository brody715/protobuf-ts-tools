import {JsonValue} from "@protobuf-ts/runtime";
import {
  RpcOptions,
  UnaryCall,
  RpcTransport,
  MethodInfo,
  ServerStreamingCall,
  ClientStreamingCall,
  DuplexStreamingCall,
  ServiceType,
} from "@protobuf-ts/runtime-rpc";
import {getHttpRule, parseHttpRule} from "../shared/google_api_http";

export type HttpTransportContext = {
  rpcOptions: RpcOptions;
};

export type HttpResponse = {
  data: unknown;
  status: number;
  headers: Record<string, unknown>;
  statusText: string;
};

export interface HttpTransport {
  // get(url: string, queryParams: Record<string, unknown>): Promise<HttpResponse>;
  post(
    url: string,
    data: unknown,
    ctx?: HttpTransportContext
  ): Promise<HttpResponse>;
}

type UnaryHandler<I extends object = object, O extends object = object> = (
  input: I,
  options: RpcOptions
) => UnaryCall<I, O>;

export class RestRpcTransport implements RpcTransport {
  // cached handler
  private unaryHandlers: Map<MethodInfo, UnaryHandler>;

  constructor(serviceType: ServiceType, private httpTransport: HttpTransport) {
    this.unaryHandlers = new Map();

    for (const method of serviceType.methods) {
      if (!method.clientStreaming && !method.serverStreaming) {
        this.unaryHandlers.set(method, this.createUnaryHandler(method));
      }
    }
  }

  mergeOptions(options?: Partial<RpcOptions> | undefined): RpcOptions {
    return {
      jsonOptions: {
        typeRegistry: [],
      },
      ...options,
    } as RpcOptions;
  }

  unary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): UnaryCall<I, O> {
    const handler = this.getUnaryHandler(method);
    return handler(input, options);
  }

  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): ServerStreamingCall<I, O> {
    throw new Error("Method not implemented.");
  }

  clientStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions
  ): ClientStreamingCall<I, O> {
    throw new Error("Method not implemented.");
  }

  duplex<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    options: RpcOptions
  ): DuplexStreamingCall<I, O> {
    throw new Error("Method not implemented.");
  }

  private getUnaryHandler<I extends object, O extends object>(
    method: MethodInfo<I, O>
  ): UnaryHandler<I, O> {
    let handler = this.unaryHandlers.get(method);
    if (!handler) {
      throw new Error(
        `unknown unary method, name=${method.name}, service=${method.service.typeName}`
      );
    }

    return handler as UnaryHandler<I, O>;
  }

  private createUnaryHandler(method: MethodInfo): UnaryHandler {
    // compute
    const httpRule = parseHttpRule(getHttpRule(method.options));

    return (input, options) => {
      const task = this.httpTransport.post(
        httpRule.post,
        method.I.toJson(input),
        {
          rpcOptions: options,
        }
      );

      const reqHeaders = options.meta || {};
      const respHeaders = task.then((r) => ({}));
      const tailers = task.then((r) => ({}));
      const response = task.then((resp) =>
        method.O.fromJson(resp.data as JsonValue)
      );

      // TODO: handle error
      const status = task.then((r) => ({
        code: r.status.toString(),
        detail: r.statusText,
      }));

      return new UnaryCall(
        method,
        reqHeaders,
        input,
        respHeaders,
        response,
        status,
        tailers
      );
    };
  }
}
