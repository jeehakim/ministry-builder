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
  /** Campaign pages and cards. */
  raised: string;
  ofGoal: string;
  gift: string;
  gifts: string;
  ends: string;
  viewCampaign: string;
  giveNow: string;
  giveAmount: string;
  campaignClosed: string;
  donorWall: string;
  campaign: string;
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
    raised: "raised",
    ofGoal: "of",
    gift: "gift",
    gifts: "gifts",
    ends: "Ends",
    viewCampaign: "View campaign",
    giveNow: "Give now",
    giveAmount: "Give",
    campaignClosed: "This campaign has ended. Thank you to everyone who gave.",
    donorWall: "Thank you to our donors",
    campaign: "Campaign",
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
    raised: "모금",
    ofGoal: "목표",
    gift: "건",
    gifts: "건",
    ends: "마감",
    viewCampaign: "캠페인 보기",
    giveNow: "지금 후원하기",
    giveAmount: "후원",
    campaignClosed: "이 캠페인은 종료되었습니다. 후원해 주신 모든 분께 감사드립니다.",
    donorWall: "후원해 주신 분들께 감사드립니다",
    campaign: "캠페인",
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
    raised: "recaudado",
    ofGoal: "de",
    gift: "donativo",
    gifts: "donativos",
    ends: "Termina",
    viewCampaign: "Ver campaña",
    giveNow: "Dona ahora",
    giveAmount: "Donar",
    campaignClosed: "Esta campaña ha terminado. Gracias a todos los que donaron.",
    donorWall: "Gracias a nuestros donantes",
    campaign: "Campaña",
  },
  zh: { name: "姓名", email: "电子邮箱", message: "留言", send: "发送", thanksTitle: "谢谢", thanksBody: "您的留言已发送，我们会尽快回复。", back: "返回网站", sendingTo: "留言发送至", raised: "已筹", ofGoal: "目标", gift: "笔", gifts: "笔", ends: "截止", viewCampaign: "查看项目", giveNow: "立即捐赠", giveAmount: "捐赠", campaignClosed: "本项目已结束。感谢每一位捐赠者。", donorWall: "感谢我们的捐赠者", campaign: "募捐项目" },
  ja: { name: "お名前", email: "メールアドレス", message: "メッセージ", send: "送信", thanksTitle: "ありがとうございます", thanksBody: "メッセージを送信しました。追ってご連絡いたします。", back: "サイトに戻る", sendingTo: "送信先", raised: "達成", ofGoal: "目標", gift: "件", gifts: "件", ends: "締切", viewCampaign: "キャンペーンを見る", giveNow: "今すぐ寄付", giveAmount: "寄付", campaignClosed: "このキャンペーンは終了しました。ご支援ありがとうございました。", donorWall: "ご寄付いただいた皆様に感謝します", campaign: "キャンペーン" },
  pt: { name: "Seu nome", email: "Seu e-mail", message: "Mensagem", send: "Enviar mensagem", thanksTitle: "Obrigado", thanksBody: "Sua mensagem foi enviada. Entraremos em contato em breve.", back: "Voltar ao site", sendingTo: "As mensagens vão para", raised: "arrecadado", ofGoal: "de", gift: "doação", gifts: "doações", ends: "Termina", viewCampaign: "Ver campanha", giveNow: "Doe agora", giveAmount: "Doar", campaignClosed: "Esta campanha terminou. Obrigado a todos que doaram.", donorWall: "Obrigado aos nossos doadores", campaign: "Campanha" },
  fr: { name: "Votre nom", email: "Votre e-mail", message: "Message", send: "Envoyer", thanksTitle: "Merci", thanksBody: "Votre message a été envoyé. Nous vous répondrons bientôt.", back: "Retour au site", sendingTo: "Les messages sont envoyés à", raised: "collectés", ofGoal: "sur", gift: "don", gifts: "dons", ends: "Fin", viewCampaign: "Voir la campagne", giveNow: "Donner maintenant", giveAmount: "Donner", campaignClosed: "Cette campagne est terminée. Merci à tous les donateurs.", donorWall: "Merci à nos donateurs", campaign: "Campagne" },
  de: { name: "Ihr Name", email: "Ihre E-Mail", message: "Nachricht", send: "Nachricht senden", thanksTitle: "Vielen Dank", thanksBody: "Ihre Nachricht wurde gesendet. Wir melden uns bald.", back: "Zurück zur Website", sendingTo: "Nachrichten gehen an", raised: "gesammelt", ofGoal: "von", gift: "Spende", gifts: "Spenden", ends: "Endet", viewCampaign: "Kampagne ansehen", giveNow: "Jetzt spenden", giveAmount: "Spenden", campaignClosed: "Diese Kampagne ist beendet. Danke an alle, die gespendet haben.", donorWall: "Danke an unsere Spender", campaign: "Kampagne" },
  vi: { name: "Tên của bạn", email: "Email của bạn", message: "Tin nhắn", send: "Gửi tin nhắn", thanksTitle: "Cảm ơn bạn", thanksBody: "Tin nhắn của bạn đã được gửi. Chúng tôi sẽ sớm liên hệ lại.", back: "Quay lại trang", sendingTo: "Tin nhắn được gửi đến", raised: "đã quyên góp", ofGoal: "trên", gift: "lượt", gifts: "lượt", ends: "Kết thúc", viewCampaign: "Xem chiến dịch", giveNow: "Ủng hộ ngay", giveAmount: "Ủng hộ", campaignClosed: "Chiến dịch này đã kết thúc. Cảm ơn tất cả những người đã ủng hộ.", donorWall: "Cảm ơn các nhà hảo tâm", campaign: "Chiến dịch" },
};

export function uiStrings(language: string): UiStrings {
  const base = language.toLowerCase().split("-")[0] ?? "en";
  return STRINGS[base] ?? STRINGS["en"]!;
}
