# Guestbook monitoring

Pulumi program that deploys the [Kubernetes Guestbook](https://github.com/pulumi/examples/tree/master/kubernetes-ts-guestbook) and scrapes it with Prometheus and Grafana.

The Guestbook workload follows the component variant of that example (Redis leader, Redis replica, three PHP frontend pods). Monitoring is added with the Prometheus Operator.

## Grafana

| | |
| --- | --- |
| User | `admin` |
| Password | `guestbook-admin` |
| URL | `pulumi stack output grafanaUrl` |

Override the password before deploy if you want a different one:

```bash
pulumi config set grafanaAdminPassword '<password>'
pulumi config set grafanaAdminUser admin
```

These values are stack outputs because the exercise asks for them. Do not reuse this password on a shared or production cluster.

How you open Grafana depends on the cluster:

| Cluster | Config | URL |
| --- | --- | --- |
| kind, using `deploy/kind-config.yaml` | `isMinikube=true` (default) | http://localhost:30300 |
| minikube | `isMinikube=true` | `http://$(minikube ip):30300` |
| Docker Desktop, EKS, GKE, AKS | `isMinikube=false` | `http://<load-balancer>` from `grafanaUrl` |

Grafana's Service is `NodePort` 30300 when `isMinikube` is true, and `LoadBalancer` otherwise. On a LoadBalancer cluster, `grafanaUrl` stays `pending` until the cloud assigns an address. Check `kubectl -n monitoring get svc kps-grafana`, then run `pulumi up` again.

The **Guestbook** dashboard is provisioned automatically. The Grafana sidecar can take about a minute to import it after the pods are ready. Open Dashboards and search for Guestbook.

## What gets scraped

The PHP and Redis images from the guestbook example do not expose Prometheus metrics. The program adds exporters instead of replacing those images.

| Signal | Source | ServiceMonitor |
| --- | --- | --- |
| Frontend request rate and active connections | nginx sidecar in the frontend pod, scraped by `nginx-prometheus-exporter` on port 9113 | `guestbook-frontend` |
| Redis memory, command rate, rejected connections | `redis_exporter` for `redis-leader` and `redis-replica` | `guestbook-redis-leader`, `guestbook-redis-replica` |
| Pod CPU and memory | kubelet cAdvisor, already scraped by kube-prometheus-stack | chart default |

nginx `stub_status` counts requests. It does not break them out by HTTP status, so the dashboard shows request rate rather than an HTTP error rate. Redis rejected connections are the backend error signal.

Prometheus Operator does not discover `prometheus.io/scrape` annotations. Those annotations are still set on the metrics Services as documentation. The ServiceMonitors are what Prometheus uses. The Helm values set an empty ServiceMonitor selector and an empty namespace selector so monitors in the `guestbook` namespace are picked up.

Control-plane components that are unreachable on kind, minikube, and most managed Kubernetes products (etcd, kube-scheduler, kube-controller-manager, kube-proxy) are not scraped. Alertmanager is left out because this exercise does not ask for paging.

## Prerequisites

- Kubernetes 1.25 or newer (`kubectl` pointed at the target cluster)
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18 or newer
- A cluster with about 2 CPU and 4 GiB free. kube-prometheus-stack is the large part of the deploy.

kind:

```bash
kind create cluster --config deploy/kind-config.yaml
```

minikube:

```bash
minikube start --cpus=2 --memory=4096
```

Docker Desktop, EKS, GKE, or AKS already provide a LoadBalancer. Use `isMinikube=false` below.

## Deploy

```bash
npm install
pulumi stack init dev
pulumi config set isMinikube true
pulumi up
```

For a cluster with LoadBalancer support:

```bash
pulumi config set isMinikube false
pulumi up
```

`Pulumi.dev.yaml` already sets `isMinikube` to true for a stack named `dev`.

The first update downloads the Helm chart and its images. Expect several minutes. The chart version is pinned to `kube-prometheus-stack` 92.16.1.

Useful outputs:

```bash
pulumi stack output grafanaUrl
pulumi stack output grafanaAdminUser
pulumi stack output grafanaAdminPassword
pulumi stack output frontendIp
```

## Open the guestbook

Generate a few requests so the request-rate panel moves.

minikube or kind (`isMinikube=true`). The frontend Service is ClusterIP, same as the original example:

```bash
kubectl -n guestbook port-forward svc/frontend 8080:80
```

Open http://localhost:8080 and submit a few messages.

LoadBalancer clusters serve the UI at `http://<frontendIp>`.

## Verify that Prometheus is scraping

Wait until the monitoring and guestbook pods are Ready:

```bash
kubectl -n monitoring get pods
kubectl -n guestbook get pods
kubectl -n guestbook get servicemonitor
```

Then either run the helper:

```bash
bash scripts/verify-metrics.sh
```

or do it by hand:

```bash
kubectl -n monitoring port-forward svc/kps-prometheus 9090:9090
```

Open http://localhost:9090/targets and confirm these ServiceMonitors are UP:

- `guestbook-frontend`
- `guestbook-redis-leader`
- `guestbook-redis-replica`

Example queries (http://localhost:9090/graph):

```promql
nginx_http_requests_total{namespace="guestbook"}
redis_up{namespace="guestbook"}
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="guestbook",container!="",container!="POD"}[5m]))
sum by (pod) (container_memory_working_set_bytes{namespace="guestbook",container!="",container!="POD"})
```

`scripts/verify-metrics.sh` runs those checks and exits non-zero if a series is missing. An empty frontend series usually means the exporter pod is not Ready yet, or Prometheus has not completed its first 15 second scrape.

In Grafana, open the Guestbook dashboard. After you load the guestbook UI you should see a non-zero request rate, Redis memory, and CPU and memory for the guestbook pods.

## Layout

```text
index.ts                          stack outputs and wiring
components/guestbook.ts           namespace, Redis, frontend, exporters
components/frontend.ts            PHP plus nginx and the nginx exporter
components/redisExporter.ts       one exporter per Redis Service
components/monitoring.ts          kube-prometheus-stack and the dashboard ConfigMap
components/serviceMonitors.ts     ServiceMonitors for frontend and both Redis roles
components/dashboard.ts           Guestbook Grafana dashboard
deploy/kind-config.yaml           kind port mapping for Grafana
scripts/verify-metrics.sh         Prometheus query check
```

## Troubleshooting

`pulumi/guestbook-php-redis` and `pulumi/guestbook-redis-replica` are `linux/amd64` images from the original example. Prometheus, Grafana, nginx, and `redis_exporter` in this project are multi-arch. On Apple Silicon, Docker Desktop usually emulates the guestbook images. If a guestbook pod fails with `exec format error`, turn on Rosetta emulation in Docker Desktop and restart the cluster.

If `grafanaUrl` is `pending`, the LoadBalancer has no address yet:

```bash
kubectl -n monitoring get svc kps-grafana
pulumi up
```

## Clean up

```bash
pulumi destroy
pulumi stack rm dev
```

kind only:

```bash
kind delete cluster
```
