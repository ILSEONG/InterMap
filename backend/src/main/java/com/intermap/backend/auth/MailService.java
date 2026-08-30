package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender mailSender;
    private final String from;
    private final boolean configured;

    public MailService(JavaMailSender mailSender, @Value("${spring.mail.username}") String from,
                        @Value("${spring.mail.host}") String host) {
        this.mailSender = mailSender;
        this.from = from;
        this.configured = !host.isBlank();
    }

    public void sendVerificationCode(String email, String code) {
        if (!configured) {
            // MAIL_HOST 미설정 — 개발 중엔 로그로만 확인
            log.info("[이메일 인증번호] {} -> {}", email, code);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("[인터맵] 이메일 인증번호");
        message.setText("인증번호: " + code + "\n5분 안에 입력해주세요.");
        mailSender.send(message);
    }
}
