// Package migrations embeds the SQL schema migrations applied by `retfast-api migrate`.
package migrations

import "embed"

// FS holds NNNN_name.up.sql / NNNN_name.down.sql files.
//
//go:embed *.sql
var FS embed.FS
