import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { partOfLabel } from "./names";

export interface ServicePort {
    name: string;
    port: number;
    targetPort?: number;
}

export interface ServiceDeploymentArgs {
    namespace: pulumi.Input<string>;
    serviceName: string;
    image: string;
    ports: ServicePort[];
    env?: pulumi.Input<k8s.types.input.core.v1.EnvVar>[];
    replicas?: number;
    serviceType?: pulumi.Input<string>;
}

/**
 * Deployment plus Service, following the component style of the Pulumi guestbook example.
 * The Service selector is only `app`, which stays stable if extra pod labels are added later.
 */
export class ServiceDeployment extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;

    constructor(name: string, args: ServiceDeploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:index:ServiceDeployment", name, {}, opts);

        const selector = { app: args.serviceName };
        const labels = {
            ...selector,
            "app.kubernetes.io/name": args.serviceName,
            "app.kubernetes.io/part-of": partOfLabel,
        };

        this.deployment = new k8s.apps.v1.Deployment(name, {
            metadata: {
                name: args.serviceName,
                namespace: args.namespace,
                labels,
            },
            spec: {
                selector: { matchLabels: selector },
                replicas: args.replicas ?? 1,
                template: {
                    metadata: { labels },
                    spec: {
                        containers: [{
                            name: args.serviceName,
                            image: args.image,
                            imagePullPolicy: "IfNotPresent",
                            env: args.env,
                            ports: args.ports.map(port => ({
                                name: port.name,
                                containerPort: port.targetPort ?? port.port,
                            })),
                            resources: {
                                requests: { cpu: "100m", memory: "100Mi" },
                            },
                        }],
                    },
                },
            },
        }, { parent: this });

        this.service = new k8s.core.v1.Service(name, {
            metadata: {
                name: args.serviceName,
                namespace: args.namespace,
                labels,
            },
            spec: {
                type: args.serviceType,
                selector,
                ports: args.ports.map(port => ({
                    name: port.name,
                    port: port.port,
                    targetPort: port.targetPort ?? port.port,
                })),
            },
        }, { parent: this });

        this.registerOutputs({
            serviceName: this.service.metadata.name,
        });
    }
}
