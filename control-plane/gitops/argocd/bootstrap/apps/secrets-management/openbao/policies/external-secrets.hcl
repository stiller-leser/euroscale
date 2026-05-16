path "euroscale/*" {
  capabilities = ["read", "list"]
}

# KV v2 data/metadata endpoints used by ESO provider.
path "euroscale/data/*" {
  capabilities = ["read", "list"]
}

path "euroscale/metadata/*" {
  capabilities = ["read", "list"]
}

# ESO probes mount metadata before reading secrets.
path "sys/internal/ui/mounts/*" {
  capabilities = ["read", "list"]
}
path "sys/health" {
  capabilities = ["read", "list"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
