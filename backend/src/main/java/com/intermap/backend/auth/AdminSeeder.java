package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

// 서버 시작 시 관리자(주인장) 계정이 없으면 만든다. 아이디는 이메일 자리에 "admin".
// 비밀번호는 ADMIN_PASSWORD 환경변수로 바꿀 수 있다 (application.properties admin.password).
@Component
public class AdminSeeder implements ApplicationRunner {

    public static final String ADMIN_EMAIL = "admin";

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final AppUserRepository repository;
    private final String password;

    public AdminSeeder(AppUserRepository repository, @Value("${admin.password}") String password) {
        this.repository = repository;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (password == null || password.isBlank() || repository.findByEmail(ADMIN_EMAIL).isPresent()) return;
        repository.save(new AppUser(ADMIN_EMAIL, new BCryptPasswordEncoder().encode(password), "주인장", null));
        log.info("관리자 계정(admin) 생성");
    }
}
