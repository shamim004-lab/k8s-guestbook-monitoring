import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
    frontendMetricsServiceName,
    partOfLabel,
    redisLeaderExporterName,
    redisReplicaExporterName,
} from "./names";

export interface GuestbookServiceMonitorsArgs {
    namespace: pulumi.Input<string>;
}

/**
 * Prometheus Operator ignores prometheus.io/* annotations. These ServiceMonitors are the
 * scrape config. Discovery works because the Helm release sets an empty ServiceMonitor
 * selector and an empty namespace selector.
 */
export class GuestbookServiceMonitors extends pulumi.ComponentResource {
    constructor(name: string, args: GuestbookServiceMonitorsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:GuestbookServiceMonitors", name, {}, opts);

        monitor(this, "frontend", args.namespace, frontendMetricsServiceName);
        monitor(this, "redis-leader", args.namespace, redisLeaderExporterName);
        monitor(this, "redis-replica", args.namespace, redisReplicaExporterName);

        this.registerOutputs({});
    }
}

function monitor(
    parent: pulumi.ComponentResource,
    name: string,
    namespace: pulumi.Input<string>,
    serviceAppLabel: string,
): k8s.apiextensions.CustomResource {
    return new k8s.apiextensions.CustomResource(`servicemonitor-${name}`, {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: {
            name: `guestbook-${name}`,
            namespace,
            labels: {
                app: serviceAppLabel,
                "app.kubernetes.io/part-of": partOfLabel,
            },
        },
        spec: {
            selector: { matchLabels: { app: serviceAppLabel } },
            namespaceSelector: { matchNames: [namespace] },
            endpoints: [{
                port: "metrics",
                path: "/metrics",
                interval: "15s",
            }],
        },
    }, { parent });
}
