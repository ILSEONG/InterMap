package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

// owner가 target에게 붙인, owner에게만 보이는 이름.
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"owner_id", "target_id"}))
public class UserAlias {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser owner;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser target;

    @Column(nullable = false, length = 20)
    private String alias;

    protected UserAlias() {
    }

    public UserAlias(AppUser owner, AppUser target, String alias) {
        this.owner = owner;
        this.target = target;
        this.alias = alias;
    }

    public void rename(String alias) {
        this.alias = alias;
    }

    public Long getId() { return id; }
    public AppUser getOwner() { return owner; }
    public AppUser getTarget() { return target; }
    public String getAlias() { return alias; }
}
