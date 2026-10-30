#!/usr/bin/env bash
# Confirm Prometheus is scraping Guestbook frontend, Redis, and pod resource metrics.
set -euo pipefail

NS="${MONITORING_NAMESPACE:-monitoring}"
APP_NS="${APP_NAMESPACE:-guestbook}"
SVC="${PROMETHEUS_SERVICE:-kps-prometheus}"
LOCAL_PORT="${LOCAL_PORT:-9090}"

echo "Monitoring pods:"
kubectl -n "$NS" get pods
echo
echo "Guestbook pods:"
kubectl -n "$APP_NS" get pods

kubectl -n "$NS" port-forward "svc/${SVC}" "${LOCAL_PORT}:9090" >/tmp/guestbook-prometheus-port-forward.log 2>&1 &
PF=$!
cleanup() {
  kill "$PF" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${LOCAL_PORT}/-/ready" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Prometheus did not become ready on localhost:${LOCAL_PORT}. See /tmp/guestbook-prometheus-port-forward.log" >&2
  exit 1
fi

check() {
  local title="$1"
  local query="$2"
  local attempt body
  echo
  echo "== ${title}"
  echo "   ${query}"
  for attempt in $(seq 1 12); do
    body="$(curl -sfG "http://127.0.0.1:${LOCAL_PORT}/api/v1/query" --data-urlencode "query=${query}")"
    if QUERY_BODY="$body" python3 - "$title" <<'PY'
import json, os, sys
title = sys.argv[1]
payload = json.loads(os.environ["QUERY_BODY"])
if payload.get("status") != "success":
    raise SystemExit(f"{title}: Prometheus returned {payload.get('status')}")
result = payload.get("data", {}).get("result", [])
if not result:
    raise SystemExit(2)
print(f"   {len(result)} series")
for series in result[:5]:
    metric = series.get("metric", {})
    labels = ",".join(f"{k}={v}" for k, v in sorted(metric.items()) if k in ("pod", "namespace", "service", "container", "instance"))
    value = series.get("value", ["", ""])[1]
    print(f"   {labels or metric.get('__name__', title)} = {value}")
PY
    then
      return 0
    fi
    echo "   no series yet, waiting for a scrape (${attempt}/12)"
    sleep 5
  done
  echo "${title}: no series after waiting. Generate frontend traffic, then retry." >&2
  exit 1
}

check "frontend requests" 'nginx_http_requests_total{namespace="guestbook"}'
check "redis exporter" 'redis_up{namespace="guestbook"}'
check "pod memory" 'container_memory_working_set_bytes{namespace="guestbook",container!="",container!="POD"}'

echo
echo "Prometheus is scraping Guestbook frontend, Redis, and pod resource metrics."
