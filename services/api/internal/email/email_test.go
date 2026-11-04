package email

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTemplatesRender(t *testing.T) {
	for _, tpl := range []string{TplWelcome, TplPasswordReset, TplEmailVerification, TplSecurity, TplEventUpdate} {
		m, err := Render(tpl, "a@example.com", Data{Name: "Kübra <script>", Link: "https://app.retfast.com/app/x?token=abc",
			AppURL: "https://app.retfast.com", EventName: "Çameli", Title: "Program", Body: "Yeni saat", Detail: "Şifre değişti"})
		if err != nil {
			t.Fatalf("%s: %v", tpl, err)
		}
		if m.Subject == "" || !strings.Contains(m.Text, "Merhaba") || !strings.Contains(m.HTML, "<!doctype html>") {
			t.Fatalf("%s: incomplete %+v", tpl, m)
		}
		if strings.Contains(m.HTML, "<script>") {
			t.Fatalf("%s: HTML not escaped", tpl)
		}
		if strings.Contains(m.HTML, "%!") || strings.Contains(m.Text, "%!") {
			t.Fatalf("%s: format artefact", tpl)
		}
	}
	if _, err := Render("nope", "a@b.c", Data{}); err == nil {
		t.Fatal("unknown template")
	}
}

func TestResendClassification(t *testing.T) {
	status := 200
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" || r.URL.Path != "/emails" {
			w.WriteHeader(400)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"id":"msg_1"}`))
	}))
	defer srv.Close()
	r := &Resend{APIKey: "key", From: "Retfast <noreply@retfast.com>", BaseURL: srv.URL}
	if id, err := r.Send(context.Background(), Message{To: "a@b.c", Subject: "s", Text: "t", HTML: "h"}); err != nil || id != "msg_1" {
		t.Fatalf("send: %q %v", id, err)
	}
	status = 401
	var perm *PermanentError
	if _, err := r.Send(context.Background(), Message{}); !errors.As(err, &perm) || perm.Reason != "provider_rejected" {
		t.Fatalf("401: %v", err)
	}
	status = 503
	if _, err := r.Send(context.Background(), Message{}); err == nil || errors.As(err, &perm) {
		t.Fatalf("503 must be transient: %v", err)
	}
	if _, err := (&Resend{}).Send(context.Background(), Message{}); !errors.Is(err, ErrUnconfigured) {
		t.Fatal("unconfigured")
	}
}

func TestBackoff(t *testing.T) {
	if Backoff(1) != 30*time.Second || Backoff(2) != time.Minute || Backoff(20) != 30*time.Minute {
		t.Fatal("backoff")
	}
}
