package com.intermap.backend.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

// 운영 관리자 — 신고 처리, 관측 화면, 데이터 동기화를 할 수 있는 계정.
//   - 주인장 계정(AdminSeeder.ADMIN_EMAIL = "admin")
//   - 환경변수 ADMIN_EMAILS에 적은 이메일의 계정 (쉼표로 구분). 저장소가 공개라 이메일은 코드에 적지 않는다.
// "주인장"과는 다르다: 주인장은 후기가 모두에게 보이는 계정 하나(admin)이고, 여기 관리자는 평소엔 보통 회원이다.
@Component
public class Admins {

    private final Set<String> emails;

    public Admins(@Value("${admin.emails:}") String emails) {
        this.emails = Arrays.stream(emails.split(","))
                .map(e -> e.trim().toLowerCase())
                .filter(e -> !e.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isAdmin(AppUser user) {
        if (user == null || user.getEmail() == null) return false;
        return AdminSeeder.ADMIN_EMAIL.equals(user.getEmail()) || emails.contains(user.getEmail().toLowerCase());
    }
}
