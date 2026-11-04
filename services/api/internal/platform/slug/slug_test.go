package slug

import "testing"

func TestMake(t *testing.T) {
	cases := map[string]string{
		"Çameli Paragliding Demo": "cameli-paragliding-demo",
		"  Kübra Özlem  ":         "kubra-ozlem",
		"Işık & Gölge 2026!":      "isik-golge-2026",
		"---":                     "",
	}
	for in, want := range cases {
		if got := Make(in, 100); got != want {
			t.Errorf("Make(%q) = %q, want %q", in, got, want)
		}
	}
	if got := Make("abcdefghij", 4); got != "abcd" {
		t.Errorf("max: %q", got)
	}
	if r := Random(8); len(r) != 8 {
		t.Errorf("Random len %d", len(r))
	}
}
