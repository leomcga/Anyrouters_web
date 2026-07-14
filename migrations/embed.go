package migrations

import (
	"embed"
	"fmt"
)

// Files keeps reviewed migration SQL available to the runtime without relying
// on the process working directory.
//
//go:embed mysql/*.sql postgres/*.sql sqlite/*.sql
var Files embed.FS

func Read(dialect string, name string) ([]byte, error) {
	path := dialect + "/" + name + ".sql"
	content, err := Files.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read embedded migration %s: %w", path, err)
	}
	return content, nil
}
