// Package slug makes URL slugs and short random ids (Turkish-aware).
package slug

import (
	"crypto/rand"
	"math/big"
	"strings"
	"unicode"
)

var turkish = strings.NewReplacer("ç", "c", "Ç", "c", "ğ", "g", "Ğ", "g", "ı", "i", "İ", "i", "ö", "o", "Ö", "o",
	"ş", "s", "Ş", "s", "ü", "u", "Ü", "u", "â", "a", "î", "i", "û", "u")

// Make converts s to a lowercase ASCII slug of at most max runes.
func Make(s string, max int) string {
	s = turkish.Replace(s)
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		switch {
		case r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			b.WriteRune(r)
			dash = false
		case !dash && b.Len() > 0:
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= max {
			break
		}
	}
	return strings.Trim(b.String(), "-")
}

const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"

// Random returns n characters from an unambiguous lowercase alphabet.
func Random(n int) string {
	out := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range out {
		v, _ := rand.Int(rand.Reader, max)
		out[i] = alphabet[v.Int64()]
	}
	return string(out)
}
