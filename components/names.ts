/** Fixed names so stack outputs, ServiceMonitors, and the README stay in sync. */
export const appNamespace = "guestbook";
export const monitoringNamespace = "monitoring";

/** Helm release name. kube-prometheus-stack truncates fullnameOverride to 26 characters. */
export const helmReleaseName = "kps";
export const prometheusFullname = "kps";
export const prometheusServiceName = "kps-prometheus";
export const grafanaServiceName = "kps-grafana";
export const grafanaNodePort = 30300;

export const frontendServiceName = "frontend";
export const frontendMetricsServiceName = "frontend-metrics";
export const redisLeaderServiceName = "redis-leader";
export const redisReplicaServiceName = "redis-replica";
export const redisLeaderExporterName = "redis-leader-exporter";
export const redisReplicaExporterName = "redis-replica-exporter";

export const defaultGrafanaAdminUser = "admin";
export const defaultGrafanaAdminPassword = "guestbook-admin";

export const partOfLabel = "guestbook";
