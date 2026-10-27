package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

// 관리자(주인장) 계정. 아이디는 이메일 자리에 "admin", 비밀번호는 ADMIN_PASSWORD 환경변수 (기본값 없음).
// 서버 시작 시 없으면 만들고, 있는데 비밀번호가 환경변수와 다르면 바꾼다 — 환경변수만 바꾸고 재배포하면 교체된다.
// 환경변수가 비어 있으면 아무것도 하지 않는다 (운영 DB에 붙는 로컬 실행이 관리자 계정을 건드리지 않게).
@Component
public class AdminSeeder implements ApplicationRunner {

    public static final String ADMIN_EMAIL = "admin";

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final AppUserRepository repository;
    private final String password;

    public AdminSeeder(AppUserRepository repository, @Value("${admin.password:}") String password) {
        this.repository = repository;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (password == null || password.isBlank()) {
            log.warn("ADMIN_PASSWORD가 비어 있어 관리자 계정을 만들거나 바꾸지 않았어요");
            return;
        }
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser admin = repository.findByEmail(ADMIN_EMAIL).orElse(null);
        if (admin == null) {
            repository.save(new AppUser(ADMIN_EMAIL, encoder.encode(password), "주인장", null));
            log.info("관리자 계정(admin) 생성");
        } else if (admin.getPasswordHash() == null || !encoder.matches(password, admin.getPasswordHash())) {
            admin.changePassword(encoder.encode(password));
            admin.issueToken(null); // 예전 비밀번호로 받은 세션도 끊는다
            repository.save(admin);
            log.info("관리자 비밀번호를 ADMIN_PASSWORD로 바꿨어요");
        }
    }
}
