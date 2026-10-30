import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { Frontend } from "./frontend";
import {
    appNamespace,
    partOfLabel,
    redisLeaderExporterName,
    redisLeaderServiceName,
    redisReplicaExporterName,
    redisReplicaServiceName,
} from "./names";
import { RedisExporter } from "./redisExporter";
import { ServiceDeployment } from "./serviceDeployment";

export interface GuestbookArgs {
    isMinikube: boolean;
}

/** Redis leader, Redis replica, PHP frontend, and Redis exporters. */
export class Guestbook extends pulumi.ComponentResource {
    public readonly namespace: pulumi.Output<string>;
    public readonly frontendIp: pulumi.Output<string>;

    constructor(name: string, args: GuestbookArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:Guestbook", name, {}, opts);

        const namespace = new k8s.core.v1.Namespace("guestbook", {
            metadata: {
                name: appNamespace,
                labels: { "app.kubernetes.io/part-of": partOfLabel },
            },
        }, { parent: this });

        new ServiceDeployment("redis-leader", {
            namespace: namespace.metadata.name,
            serviceName: redisLeaderServiceName,
            image: "redis",
            ports: [{ name: "redis", port: 6379 }],
        }, { parent: this });

        new ServiceDeployment("redis-replica", {
            namespace: namespace.metadata.name,
            serviceName: redisReplicaServiceName,
            image: "pulumi/guestbook-redis-replica",
            env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
            ports: [{ name: "redis", port: 6379 }],
        }, { parent: this });

        const frontend = new Frontend("frontend", {
            namespace: namespace.metadata.name,
            isMinikube: args.isMinikube,
        }, { parent: this });

        new RedisExporter("redis-leader-exporter", {
            namespace: namespace.metadata.name,
            serviceName: redisLeaderExporterName,
            redisServiceName: redisLeaderServiceName,
        }, { parent: this });

        new RedisExporter("redis-replica-exporter", {
            namespace: namespace.metadata.name,
            serviceName: redisReplicaExporterName,
            redisServiceName: redisReplicaServiceName,
        }, { parent: this });

        this.namespace = namespace.metadata.name;
        this.frontendIp = frontend.endpoint;
        this.registerOutputs({
            namespace: this.namespace,
            frontendIp: this.frontendIp,
        });
    }
}
