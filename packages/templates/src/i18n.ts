/** Fixed UI strings in the templates (form labels, thank-you page). Content strings come from the document. */
export interface UiStrings {
  name: string;
  email: string;
  message: string;
  send: string;
  thanksTitle: string;
  thanksBody: string;
  back: string;
  sendingTo: string;
}

const STRINGS: Record<string, UiStrings> = {
  en: {
    name: "Your name",
    email: "Your email",
    message: "Message",
    send: "Send message",
    thanksTitle: "Thank you",
    thanksBody: "Your message has been sent. We will get back to you soon.",
    back: "Back to the site",
    sendingTo: "Messages go to",
  },
  ko: {
    name: "이름",
    email: "이메일",
    message: "메시지",
    send: "메시지 보내기",
    thanksTitle: "감사합니다",
    thanksBody: "메시지가 전송되었습니다. 곧 연락드리겠습니다.",
    back: "사이트로 돌아가기",
    sendingTo: "메시지 수신",
  },
  es: {
    name: "Tu nombre",
    email: "Tu correo electrónico",
    message: "Mensaje",
    send: "Enviar mensaje",
    thanksTitle: "Gracias",
    thanksBody: "Tu mensaje ha sido enviado. Te responderemos pronto.",
    back: "Volver al sitio",
    sendingTo: "Los mensajes llegan a",
  },
  zh: { name: "姓名", email: "电子邮箱", message: "留言", send: "发送", thanksTitle: "谢谢", thanksBody: "您的留言已发送，我们会尽快回复。", back: "返回网站", sendingTo: "留言发送至" },
  ja: { name: "お名前", email: "メールアドレス", message: "メッセージ", send: "送信", thanksTitle: "ありがとうございます", thanksBody: "メッセージを送信しました。追ってご連絡いたします。", back: "サイトに戻る", sendingTo: "送信先" },
  pt: { name: "Seu nome", email: "Seu e-mail", message: "Mensagem", send: "Enviar mensagem", thanksTitle: "Obrigado", thanksBody: "Sua mensagem foi enviada. Entraremos em contato em breve.", back: "Voltar ao site", sendingTo: "As mensagens vão para" },
  fr: { name: "Votre nom", email: "Votre e-mail", message: "Message", send: "Envoyer", thanksTitle: "Merci", thanksBody: "Votre message a été envoyé. Nous vous répondrons bientôt.", back: "Retour au site", sendingTo: "Les messages sont envoyés à" },
  de: { name: "Ihr Name", email: "Ihre E-Mail", message: "Nachricht", send: "Nachricht senden", thanksTitle: "Vielen Dank", thanksBody: "Ihre Nachricht wurde gesendet. Wir melden uns bald.", back: "Zurück zur Website", sendingTo: "Nachrichten gehen an" },
  vi: { name: "Tên của bạn", email: "Email của bạn", message: "Tin nhắn", send: "Gửi tin nhắn", thanksTitle: "Cảm ơn bạn", thanksBody: "Tin nhắn của bạn đã được gửi. Chúng tôi sẽ sớm liên hệ lại.", back: "Quay lại trang", sendingTo: "Tin nhắn được gửi đến" },
};

export function uiStrings(language: string): UiStrings {
  const base = language.toLowerCase().split("-")[0] ?? "en";
  return STRINGS[base] ?? STRINGS["en"]!;
}
