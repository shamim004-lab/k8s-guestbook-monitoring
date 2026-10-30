import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { frontendMetricsServiceName, frontendServiceName, partOfLabel } from "./names";

export interface FrontendArgs {
    namespace: pulumi.Input<string>;
    isMinikube: boolean;
}

/**
 * The upstream PHP image has no /metrics endpoint. An nginx sidecar terminates client
 * traffic, proxies to PHP on localhost, and publishes stub_status. nginx-prometheus-exporter
 * turns that into a Prometheus text endpoint on port 9113.
 *
 * User traffic uses the `frontend` Service. Prometheus scrapes the ClusterIP
 * `frontend-metrics` Service so the metrics port is not published on the LoadBalancer.
 */
export class Frontend extends pulumi.ComponentResource {
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: FrontendArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:Frontend", name, {}, opts);

        const selector = { app: frontendServiceName };
        const podLabels = {
            ...selector,
            "app.kubernetes.io/name": frontendServiceName,
            "app.kubernetes.io/part-of": partOfLabel,
        };

        const nginxConfig = new k8s.core.v1.ConfigMap("frontend-nginx", {
            metadata: {
                name: "frontend-nginx",
                namespace: args.namespace,
                labels: podLabels,
            },
            data: {
                "default.conf": nginxConf,
            },
        }, { parent: this });

        const deployment = new k8s.apps.v1.Deployment("frontend", {
            metadata: {
                name: frontendServiceName,
                namespace: args.namespace,
                labels: podLabels,
            },
            spec: {
                replicas: 3,
                selector: { matchLabels: selector },
                template: {
                    metadata: { labels: podLabels },
                    spec: {
                        containers: [
                            {
                                name: "frontend",
                                image: "pulumi/guestbook-php-redis",
                                imagePullPolicy: "IfNotPresent",
                                env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                                ports: [{ name: "http", containerPort: 80 }],
                                resources: { requests: { cpu: "100m", memory: "100Mi" } },
                            },
                            {
                                name: "nginx",
                                image: "nginx:1.27-alpine",
                                imagePullPolicy: "IfNotPresent",
                                ports: [{ name: "proxy", containerPort: 8080 }],
                                resources: { requests: { cpu: "50m", memory: "64Mi" } },
                                volumeMounts: [{
                                    name: "nginx-conf",
                                    mountPath: "/etc/nginx/conf.d/default.conf",
                                    subPath: "default.conf",
                                }],
                                readinessProbe: {
                                    httpGet: { path: "/", port: 8080 },
                                    initialDelaySeconds: 5,
                                    periodSeconds: 10,
                                },
                            },
                            {
                                name: "nginx-exporter",
                                image: "nginx/nginx-prometheus-exporter:1.4.2",
                                imagePullPolicy: "IfNotPresent",
                                args: ["--nginx.scrape-uri=http://127.0.0.1:8080/nginx_status"],
                                ports: [{ name: "metrics", containerPort: 9113 }],
                                resources: { requests: { cpu: "20m", memory: "32Mi" } },
                            },
                        ],
                        volumes: [{
                            name: "nginx-conf",
                            configMap: { name: nginxConfig.metadata.name },
                        }],
                    },
                },
            },
        }, { parent: this });

        const serviceType = args.isMinikube ? "ClusterIP" : "LoadBalancer";
        const service = new k8s.core.v1.Service("frontend", {
            metadata: {
                name: frontendServiceName,
                namespace: args.namespace,
                labels: podLabels,
            },
            spec: {
                type: serviceType,
                selector,
                ports: [{ name: "http", port: 80, targetPort: 8080 }],
            },
        }, { parent: this, dependsOn: [deployment] });

        new k8s.core.v1.Service("frontend-metrics", {
            metadata: {
                name: frontendMetricsServiceName,
                namespace: args.namespace,
                labels: {
                    app: frontendMetricsServiceName,
                    "app.kubernetes.io/name": frontendServiceName,
                    "app.kubernetes.io/part-of": partOfLabel,
                    "app.kubernetes.io/component": "metrics",
                },
                annotations: {
                    "prometheus.io/scrape": "true",
                    "prometheus.io/port": "9113",
                    "prometheus.io/path": "/metrics",
                },
            },
            spec: {
                type: "ClusterIP",
                selector,
                ports: [{ name: "metrics", port: 9113, targetPort: 9113 }],
            },
        }, { parent: this });

        this.endpoint = args.isMinikube
            ? service.spec.clusterIP
            : service.status.apply(status => {
                const ingress = status?.loadBalancer?.ingress ?? [];
                return ingress[0]?.ip ?? ingress[0]?.hostname ?? "pending";
            });

        this.registerOutputs({ endpoint: this.endpoint });
    }
}

const nginxConf = `
server {
    listen 8080;
    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`.trim();
