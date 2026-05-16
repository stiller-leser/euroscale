path "euroscale/metadata" {
  capabilities = ["list"]
}

path "euroscale/metadata/*" {
  capabilities = ["list", "read"]
}
