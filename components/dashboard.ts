import { appNamespace } from "./names";

interface GridPos {
    h: number;
    w: number;
    x: number;
    y: number;
}

const datasource = { type: "prometheus", uid: "prometheus" };

function timeseries(id: number, title: string, expr: string, unit: string, gridPos: GridPos, legend: string) {
    return {
        id,
        type: "timeseries",
        title,
        datasource,
        gridPos,
        targets: [{ refId: "A", expr, legendFormat: legend }],
        fieldConfig: {
            defaults: { unit, custom: { drawStyle: "line", fillOpacity: 10 } },
            overrides: [],
        },
        options: {
            legend: { displayMode: "list", placement: "bottom" },
            tooltip: { mode: "multi" },
        },
    };
}

function stat(id: number, title: string, expr: string, gridPos: GridPos) {
    return {
        id,
        type: "stat",
        title,
        datasource,
        gridPos,
        targets: [{ refId: "A", expr, legendFormat: "{{pod}}" }],
        fieldConfig: {
            defaults: {
                unit: "none",
                thresholds: {
                    mode: "absolute",
                    steps: [
                        { color: "red", value: null },
                        { color: "green", value: 1 },
                    ],
                },
            },
            overrides: [],
        },
        options: {
            reduceOptions: { calcs: ["lastNotNull"] },
            colorMode: "value",
            graphMode: "none",
        },
    };
}

/** Grafana dashboard JSON. The kube-prometheus-stack sidecar loads ConfigMaps labeled grafana_dashboard=1. */
export function guestbookDashboard(): string {
    const ns = appNamespace;
    const dashboard = {
        uid: "guestbook-overview",
        title: "Guestbook",
        tags: ["guestbook"],
        timezone: "browser",
        schemaVersion: 39,
        refresh: "30s",
        time: { from: "now-1h", to: "now" },
        panels: [
            timeseries(
                1,
                "Frontend request rate",
                `sum(rate(nginx_http_requests_total{namespace="${ns}"}[5m]))`,
                "reqps",
                { h: 8, w: 12, x: 0, y: 0 },
                "requests/s",
            ),
            timeseries(
                2,
                "Frontend active connections",
                `sum(nginx_connections_active{namespace="${ns}"})`,
                "short",
                { h: 8, w: 12, x: 12, y: 0 },
                "connections",
            ),
            timeseries(
                3,
                "Redis memory",
                `redis_memory_used_bytes{namespace="${ns}"}`,
                "bytes",
                { h: 8, w: 12, x: 0, y: 8 },
                "{{pod}}",
            ),
            timeseries(
                4,
                "Redis command rate",
                `sum by (pod) (rate(redis_commands_processed_total{namespace="${ns}"}[5m]))`,
                "ops",
                { h: 8, w: 12, x: 12, y: 8 },
                "{{pod}}",
            ),
            timeseries(
                5,
                "Pod CPU",
                `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${ns}",container!="",container!="POD"}[5m]))`,
                "short",
                { h: 8, w: 12, x: 0, y: 16 },
                "{{pod}}",
            ),
            timeseries(
                6,
                "Pod memory",
                `sum by (pod) (container_memory_working_set_bytes{namespace="${ns}",container!="",container!="POD"})`,
                "bytes",
                { h: 8, w: 12, x: 12, y: 16 },
                "{{pod}}",
            ),
            stat(7, "Redis up", `min(redis_up{namespace="${ns}"})`, { h: 4, w: 8, x: 0, y: 24 }),
            stat(8, "Frontend exporter up", `min(nginx_up{namespace="${ns}"})`, { h: 4, w: 8, x: 8, y: 24 }),
            timeseries(
                9,
                "Redis rejected connections",
                `sum by (pod) (rate(redis_rejected_connections_total{namespace="${ns}"}[5m]))`,
                "ops",
                { h: 4, w: 8, x: 16, y: 24 },
                "{{pod}}",
            ),
        ],
    };
    return JSON.stringify(dashboard);
}
