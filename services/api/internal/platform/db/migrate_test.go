package db

import (
	"testing"
	"testing/fstest"

	"github.com/mdenizay/retfast/services/api/migrations"
)

func TestEmbeddedMigrationsLoad(t *testing.T) {
	m, err := LoadMigrations(migrations.FS)
	if err != nil || len(m) == 0 || m[0].Version != 1 || m[0].Down == "" {
		t.Fatalf("%v %v", m, err)
	}
}

func TestMigrationValidation(t *testing.T) {
	missingDown := fstest.MapFS{"0001_a.up.sql": {Data: []byte("x")}}
	if _, err := LoadMigrations(missingDown); err == nil {
		t.Fatal("missing down accepted")
	}
	gap := fstest.MapFS{"0001_a.up.sql": {Data: []byte("x")}, "0001_a.down.sql": {Data: []byte("x")},
		"0003_c.up.sql": {Data: []byte("x")}, "0003_c.down.sql": {Data: []byte("x")}}
	if _, err := LoadMigrations(gap); err == nil {
		t.Fatal("gap accepted")
	}
}
