// Package email renders transactional emails, queues them in email_outbox and
// delivers them through Resend with bounded retries (ADR-007).
//
// Emails never contain passwords or GPS history. Bodies are purged from the
// outbox once a message reaches a terminal state.
package email

import (
	"bytes"
	"fmt"
	htmltpl "html/template"
	"strings"
	texttpl "text/template"
)

// Template names (match the email_outbox CHECK constraint).
const (
	TplWelcome           = "welcome"
	TplPasswordReset     = "password_reset"
	TplEmailVerification = "email_verification"
	TplSecurity          = "security_notification"
	TplEventUpdate       = "event_update"
)

// Data is the template input. Link must be an https URL built by the server.
type Data struct {
	Name      string
	Link      string
	AppURL    string
	EventName string
	Title     string
	Body      string // plain text paragraph(s); HTML-escaped in the HTML part
	Detail    string // security notification detail, e.g. "Şifreniz değiştirildi."
}

// Message is a rendered email.
type Message struct {
	ID       string // outbox id, used as provider idempotency key
	Template string
	To       string
	Subject  string
	Text     string
	HTML     string
}

type tpl struct {
	subject string
	text    string
	html    string // inner HTML; wrapped in layout
}

var templates = map[string]tpl{
	TplWelcome: {
		subject: "Retfast'e hoş geldiniz / Welcome to Retfast",
		text: `Merhaba {{.Name}},

Retfast hesabınız oluşturuldu. Uçuşlarınızı kaydedebilir, etkinliklere katılabilir ve konumunuzu güvenle paylaşabilirsiniz.

Uygulamayı açın: {{.AppURL}}

---
Hello {{.Name}}, your Retfast account has been created. Open the app: {{.AppURL}}

Retfast`,
		html: `<p>Merhaba {{.Name}},</p>
<p>Retfast hesabınız oluşturuldu. Uçuşlarınızı kaydedebilir, etkinliklere katılabilir ve konumunuzu güvenle paylaşabilirsiniz.</p>
<p><a href="{{.AppURL}}" style="{{btn}}">Retfast'i aç</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#6b7280">Hello {{.Name}}, your Retfast account has been created.</p>`,
	},
	TplPasswordReset: {
		subject: "Retfast şifre sıfırlama / Password reset",
		text: `Merhaba {{.Name}},

Retfast hesabınız için şifre sıfırlama talebi aldık. Yeni şifre belirlemek için bu bağlantıyı açın (1 saat geçerlidir):

{{.Link}}

Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.

---
Someone requested a password reset for your Retfast account. Open the link above within 1 hour to choose a new password. If it was not you, ignore this email.

Retfast`,
		html: `<p>Merhaba {{.Name}},</p>
<p>Retfast hesabınız için şifre sıfırlama talebi aldık. Yeni şifre belirlemek için aşağıdaki düğmeyi kullanın (1 saat geçerlidir).</p>
<p><a href="{{.Link}}" style="{{btn}}">Şifremi sıfırla</a></p>
<p style="color:#6b7280">Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#6b7280">Password reset requested. The link is valid for 1 hour. If it was not you, ignore this email.</p>`,
	},
	TplEmailVerification: {
		subject: "Retfast e-posta doğrulama / Verify your email",
		text: `Merhaba {{.Name}},

E-posta adresinizi doğrulamak için bu bağlantıyı açın (48 saat geçerlidir):

{{.Link}}

---
Please verify your email address using the link above (valid for 48 hours).

Retfast`,
		html: `<p>Merhaba {{.Name}},</p>
<p>E-posta adresinizi doğrulamak için aşağıdaki düğmeyi kullanın (48 saat geçerlidir).</p>
<p><a href="{{.Link}}" style="{{btn}}">E-postamı doğrula</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#6b7280">Please verify your email address (link valid for 48 hours).</p>`,
	},
	TplSecurity: {
		subject: "Retfast güvenlik bildirimi / Security notice",
		text: `Merhaba {{.Name}},

{{.Detail}}

Bu işlemi siz yapmadıysanız hemen şifrenizi sıfırlayın ve bizimle iletişime geçin: {{.AppURL}}

---
Security notice for your Retfast account. If this was not you, reset your password immediately.

Retfast`,
		html: `<p>Merhaba {{.Name}},</p>
<p>{{.Detail}}</p>
<p>Bu işlemi siz yapmadıysanız hemen şifrenizi sıfırlayın.</p>
<p><a href="{{.AppURL}}" style="{{btn}}">Retfast'i aç</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#6b7280">Security notice: if this was not you, reset your password immediately.</p>`,
	},
	TplEventUpdate: {
		subject: "{{.EventName}}: {{.Title}}",
		text: `Merhaba {{.Name}},

{{.EventName}} etkinliği için bir güncelleme var:

{{.Title}}
{{.Body}}

{{.Link}}

Retfast`,
		html: `<p>Merhaba {{.Name}},</p>
<p><strong>{{.EventName}}</strong> etkinliği için bir güncelleme var:</p>
<h3 style="margin:16px 0 4px">{{.Title}}</h3>
<p style="white-space:pre-line">{{.Body}}</p>
<p><a href="{{.Link}}" style="{{btn}}">Etkinliği görüntüle</a></p>`,
	},
}

const layout = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Retfast</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Retfast</td></tr>
<tr><td style="font-size:15px;line-height:1.55">{{CONTENT}}</td></tr>
<tr><td style="font-size:12px;color:#9ca3af;padding-top:20px">Retfast canlı uçuş takibi · Bu e-posta otomatik gönderilmiştir.</td></tr>
</table></td></tr></table></body></html>`

const btnStyle = "display:inline-block;background:#0f62fe;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600"

// Render produces a message for template name.
func Render(name, to string, d Data) (Message, error) {
	t, ok := templates[name]
	if !ok {
		return Message{}, fmt.Errorf("unknown email template %q", name)
	}
	if d.Name == "" {
		d.Name = "Retfast kullanıcısı"
	}
	var subj, txt, html bytes.Buffer
	st, err := texttpl.New("s").Parse(t.subject)
	if err != nil {
		return Message{}, err
	}
	if err := st.Execute(&subj, d); err != nil {
		return Message{}, err
	}
	tt, err := texttpl.New("t").Parse(t.text)
	if err != nil {
		return Message{}, err
	}
	if err := tt.Execute(&txt, d); err != nil {
		return Message{}, err
	}
	ht, err := htmltpl.New("h").Funcs(htmltpl.FuncMap{"btn": func() htmltpl.CSS { return htmltpl.CSS(btnStyle) }}).Parse(t.html)
	if err != nil {
		return Message{}, err
	}
	if err := ht.Execute(&html, d); err != nil {
		return Message{}, err
	}
	subject := strings.ReplaceAll(subj.String(), "\n", " ")
	return Message{Template: name, To: to, Subject: subject, Text: txt.String(), HTML: strings.Replace(layout, "{{CONTENT}}", html.String(), 1)}, nil
}
