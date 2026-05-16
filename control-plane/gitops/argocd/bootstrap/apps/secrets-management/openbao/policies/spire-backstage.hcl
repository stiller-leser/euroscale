path "euroscale/metadata" {
  capabilities = ["list"]
}

path "euroscale/metadata/*" {
  capabilities = ["list", "read"]
}

path "euroscale/data/*" {
  capabilities = ["read", "list"]
}
