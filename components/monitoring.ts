import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookDashboard } from "./dashboard";
import {
    grafanaNodePort,
    grafanaServiceName,
    helmReleaseName,
    monitoringNamespace,
    prometheusFullname,
} from "./names";

export interface MonitoringStackArgs {
    isMinikube: boolean;
    grafanaAdminUser: string;
    grafanaAdminPassword: string;
}

/**
 * kube-prometheus-stack installs the Prometheus Operator, Prometheus, Grafana,
 * kube-state-metrics, and node-exporter. cAdvisor metrics from the kubelet
 * provide per-pod CPU and memory without an extra exporter.
 */
export class MonitoringStack extends pulumi.ComponentResource {
    public readonly release: k8s.helm.v3.Release;
    public readonly grafanaUrl: pulumi.Output<string>;

    constructor(name: string, args: MonitoringStackArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:MonitoringStack", name, {}, opts);

        const namespace = new k8s.core.v1.Namespace("monitoring", {
            metadata: { name: monitoringNamespace },
        }, { parent: this });

        const grafanaService: Record<string, string | number> = {
            type: args.isMinikube ? "NodePort" : "LoadBalancer",
            port: 80,
        };
        if (args.isMinikube) {
            grafanaService.nodePort = grafanaNodePort;
        }

        this.release = new k8s.helm.v3.Release("kube-prometheus-stack", {
            name: helmReleaseName,
            chart: "kube-prometheus-stack",
            version: "92.16.1",
            namespace: namespace.metadata.name,
            repositoryOpts: {
                repo: "https://prometheus-community.github.io/helm-charts",
            },
            timeout: 900,
            values: {
                fullnameOverride: prometheusFullname,
                defaultRules: {
                    rules: {
                        alertmanager: false,
                        etcd: false,
                        kubeControllerManager: false,
                        kubeProxy: false,
                        kubeSchedulerAlerting: false,
                        kubeSchedulerRecording: false,
                    },
                },
                alertmanager: { enabled: false },
                kubeEtcd: { enabled: false },
                kubeControllerManager: { enabled: false },
                kubeScheduler: { enabled: false },
                kubeProxy: { enabled: false },
                grafana: {
                    adminUser: args.grafanaAdminUser,
                    adminPassword: args.grafanaAdminPassword,
                    service: grafanaService,
                    resources: {
                        requests: { cpu: "100m", memory: "256Mi" },
                        limits: { memory: "512Mi" },
                    },
                    sidecar: {
                        dashboards: {
                            enabled: true,
                            label: "grafana_dashboard",
                            labelValue: "1",
                            searchNamespace: "ALL",
                        },
                    },
                },
                prometheus: {
                    prometheusSpec: {
                        retention: "12h",
                        resources: {
                            requests: { cpu: "200m", memory: "512Mi" },
                            limits: { memory: "2Gi" },
                        },
                        serviceMonitorSelectorNilUsesHelmValues: false,
                        serviceMonitorSelector: {},
                        serviceMonitorNamespaceSelector: {},
                        podMonitorSelectorNilUsesHelmValues: false,
                        podMonitorSelector: {},
                        podMonitorNamespaceSelector: {},
                    },
                },
            },
        }, { parent: this, dependsOn: [namespace] });

        new k8s.core.v1.ConfigMap("guestbook-dashboard", {
            metadata: {
                name: "guestbook-dashboard",
                namespace: namespace.metadata.name,
                labels: { grafana_dashboard: "1" },
            },
            data: {
                "guestbook.json": guestbookDashboard(),
            },
        }, { parent: this, dependsOn: [this.release] });

        if (args.isMinikube) {
            this.grafanaUrl = pulumi.output(`http://localhost:${grafanaNodePort}`);
        } else if (pulumi.runtime.isDryRun()) {
            // Avoid reading a Service that does not exist yet. `pulumi up` resolves the address.
            this.grafanaUrl = pulumi.output("pending");
        } else {
            const grafana = k8s.core.v1.Service.get(grafanaServiceName, pulumi.interpolate`${namespace.metadata.name}/${grafanaServiceName}`, {
                parent: this,
                dependsOn: [this.release],
            });
            this.grafanaUrl = grafana.status.apply(status => {
                const ingress = status?.loadBalancer?.ingress ?? [];
                const host = ingress[0]?.ip ?? ingress[0]?.hostname;
                return host ? `http://${host}` : "pending";
            });
        }

        this.registerOutputs({ grafanaUrl: this.grafanaUrl });
    }
}
