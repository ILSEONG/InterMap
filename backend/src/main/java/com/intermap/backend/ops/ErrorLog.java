package com.intermap.backend.ops;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.AppenderBase;
import jakarta.annotation.PostConstruct;
import org.slf4j.ILoggerFactory;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.regex.Pattern;

// 서버 로그 중 경고·오류(WARN 이상)의 최근 몇 건 — 관측 화면이 읽는다.
// 호스팅 로그 화면을 열지 않아도 "방금 뭐가 터졌는지"를 앱에서 본다.
// 이메일 주소는 앞 두 글자만 남기고 가린다 (화면에 회원 이메일이 그대로 뜨지 않게).
@Component
public class ErrorLog {

    public record Entry(Instant at, String level, String logger, String message, String error) {
    }

    private static final int KEEP = 50;
    private static final Pattern EMAIL = Pattern.compile("([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})");

    private final Deque<Entry> entries = new ArrayDeque<>();
    private long errors;
    private long warnings;

    @PostConstruct
    void attach() {
        ILoggerFactory factory = LoggerFactory.getILoggerFactory();
        if (!(factory instanceof LoggerContext context)) return;
        AppenderBase<ILoggingEvent> appender = new AppenderBase<>() {
            @Override
            protected void append(ILoggingEvent event) {
                if (event.getLevel().isGreaterOrEqual(Level.WARN)) add(event);
            }
        };
        appender.setContext(context);
        appender.setName("ops-recent");
        appender.start();
        context.getLogger(Logger.ROOT_LOGGER_NAME).addAppender(appender);
    }

    private void add(ILoggingEvent event) {
        IThrowableProxy thrown = event.getThrowableProxy();
        String name = event.getLoggerName();
        add(new Entry(Instant.ofEpochMilli(event.getTimeStamp()), event.getLevel().toString(),
                name.substring(name.lastIndexOf('.') + 1),
                clean(event.getFormattedMessage(), 300),
                thrown == null ? null : clean(shortName(thrown.getClassName()) + ": " + thrown.getMessage(), 400)));
    }

    synchronized void add(Entry entry) {
        if ("ERROR".equals(entry.level())) errors++;
        else warnings++;
        entries.addFirst(entry);
        while (entries.size() > KEEP) entries.removeLast();
    }

    public synchronized List<Entry> recent() {
        return List.copyOf(entries);
    }

    public synchronized long errors() {
        return errors;
    }

    public synchronized long warnings() {
        return warnings;
    }

    private static String shortName(String className) {
        return className == null ? "" : className.substring(className.lastIndexOf('.') + 1);
    }

    // 한 줄로 줄이고, 이메일을 가리고, 길면 자른다
    static String clean(String text, int max) {
        if (text == null) return "";
        String flat = EMAIL.matcher(text.replaceAll("\\s+", " ").trim()).replaceAll("$1***@$2");
        return flat.length() > max ? flat.substring(0, max - 1) + "…" : flat;
    }
}
