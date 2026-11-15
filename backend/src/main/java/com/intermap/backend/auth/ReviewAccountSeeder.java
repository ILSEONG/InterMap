package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

// 앱 심사용 계정 (App Store·Play 심사자가 로그인해 보는 계정). 평범한 회원이고 특별한 권한은 없다.
// 이메일 인증을 거칠 수 없는 심사자를 위해, 비밀번호를 REVIEW_ACCOUNT_PASSWORD 환경변수로 정해 두면 서버 시작 때 만들어 둔다.
//   - 환경변수가 비어 있으면 아무것도 하지 않는다 (계정을 만들지도, 있는 계정을 건드리지도 않는다)
//   - 값을 바꾸고 재배포하면 비밀번호가 그 값으로 바뀌고, 예전 비밀번호로 받은 로그인은 끊긴다
//   - 심사가 끝나 계정이 필요 없으면 앱에서 탈퇴시키고 환경변수를 지운다
// 이메일은 운영자가 받는 주소여야 한다 — 인증번호 로그인의 번호가 그 주소로 가기 때문이다 (남의 도메인 주소를 쓰면 그쪽이 로그인할 수 있다).
@Component
@Order(20)
public class ReviewAccountSeeder implements ApplicationRunner {

    static final String NICKNAME = "심사용";

    private static final Logger log = LoggerFactory.getLogger(ReviewAccountSeeder.class);

    private final AppUserRepository repository;
    private final Sessions sessions;
    private final String email;
    private final String password;

    public ReviewAccountSeeder(AppUserRepository repository, Sessions sessions,
                               @Value("${review.account.email:intermap0+review@gmail.com}") String email,
                               @Value("${review.account.password:}") String password) {
        this.repository = repository;
        this.sessions = sessions;
        this.email = email == null ? "" : email.trim().toLowerCase();
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (password == null || password.isBlank() || email.isBlank()) return;
        if (password.length() < 8) {
            log.warn("REVIEW_ACCOUNT_PASSWORD가 8자보다 짧아 심사용 계정을 만들지 않았어요");
            return;
        }
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        AppUser account = repository.findByEmail(email).orElse(null);
        if (account == null) {
            repository.save(new AppUser(email, encoder.encode(password), freeNickname(), null));
            log.info("심사용 계정 생성");
        } else if (account.getPasswordHash() == null || !encoder.matches(password, account.getPasswordHash())) {
            account.changePassword(encoder.encode(password));
            sessions.closeAll(account);
            repository.save(account);
            log.info("심사용 계정 비밀번호를 REVIEW_ACCOUNT_PASSWORD로 바꿨어요");
        }
    }

    // 누가 이미 같은 닉네임을 쓰고 있으면 숫자를 붙인다
    private String freeNickname() {
        String name = NICKNAME;
        for (int n = 2; repository.findByNickname(name).isPresent() && n < 100; n++) name = NICKNAME + n;
        return name;
    }
}
