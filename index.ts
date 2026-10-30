import * as pulumi from "@pulumi/pulumi";
import { Guestbook } from "./components/guestbook";
import { MonitoringStack } from "./components/monitoring";
import { defaultGrafanaAdminPassword, defaultGrafanaAdminUser } from "./components/names";
import { GuestbookServiceMonitors } from "./components/serviceMonitors";

const config = new pulumi.Config();

// Default matches the upstream guestbook example: minikube has no LoadBalancer.
// Set false on Docker Desktop, EKS, GKE, or AKS.
const isMinikube = config.getBoolean("isMinikube") ?? true;

// The assignment asks for these credentials as stack outputs. Override with
// `pulumi config set` before using a shared cluster. Do not keep a real password here.
const grafanaAdminUser = config.get("grafanaAdminUser") ?? defaultGrafanaAdminUser;
const grafanaAdminPassword = config.get("grafanaAdminPassword") ?? defaultGrafanaAdminPassword;

const guestbook = new Guestbook("guestbook", { isMinikube });

const monitoring = new MonitoringStack("monitoring", {
    isMinikube,
    grafanaAdminUser,
    grafanaAdminPassword,
});

// ServiceMonitor is a CRD installed by the Helm release, and it is created in the guestbook namespace.
new GuestbookServiceMonitors("guestbook-servicemonitors", {
    namespace: guestbook.namespace,
}, { dependsOn: [guestbook, monitoring] });

export const frontendIp = guestbook.frontendIp;
export const grafanaUrl = monitoring.grafanaUrl;
export { grafanaAdminUser, grafanaAdminPassword };
