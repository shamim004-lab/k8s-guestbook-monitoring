import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { partOfLabel } from "./names";

export interface RedisExporterArgs {
    namespace: pulumi.Input<string>;
    serviceName: string;
    /** Guestbook Redis Service in the same namespace, for example redis-leader. */
    redisServiceName: string;
}

/** Sidecar-free Redis metrics. One exporter Deployment per Redis Service. */
export class RedisExporter extends pulumi.ComponentResource {
    constructor(name: string, args: RedisExporterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:RedisExporter", name, {}, opts);

        const labels = {
            app: args.serviceName,
            "app.kubernetes.io/name": args.serviceName,
            "app.kubernetes.io/part-of": partOfLabel,
            "app.kubernetes.io/component": "metrics",
        };

        const deployment = new k8s.apps.v1.Deployment(name, {
            metadata: {
                name: args.serviceName,
                namespace: args.namespace,
                labels,
            },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: args.serviceName } },
                template: {
                    metadata: { labels },
                    spec: {
                        containers: [{
                            name: "redis-exporter",
                            image: "oliver006/redis_exporter:v1.96.0-alpine",
                            imagePullPolicy: "IfNotPresent",
                            args: [`--redis.addr=redis://${args.redisServiceName}:6379`],
                            ports: [{ name: "metrics", containerPort: 9121 }],
                            resources: { requests: { cpu: "20m", memory: "32Mi" } },
                            readinessProbe: {
                                httpGet: { path: "/metrics", port: 9121 },
                                initialDelaySeconds: 5,
                                periodSeconds: 10,
                            },
                        }],
                    },
                },
            },
        }, { parent: this });

        new k8s.core.v1.Service(name, {
            metadata: {
                name: args.serviceName,
                namespace: args.namespace,
                labels,
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "9121",
                    "prometheus.io/path": "/metrics",
                },
            },
            spec: {
                type: "ClusterIP",
                selector: { app: args.serviceName },
                ports: [{ name: "metrics", port: 9121, targetPort: 9121 }],
            },
        }, { parent: this, dependsOn: [deployment] });

        this.registerOutputs({});
    }
}
