//! Etkinlik bazlı yetki. Her uç `Access::load` ile başlar; kurallar tek yerde durur.
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    EventAdmin,
    Pilot,
    Retriever,
    Observer,
}

impl Role {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "event_admin" => Self::EventAdmin,
            "pilot" => Self::Pilot,
            "retriever" => Self::Retriever,
            "observer" => Self::Observer,
            _ => return None,
        })
    }
}

#[derive(Debug)]
pub struct Access {
    pub user: AuthUser,
    pub event_id: Uuid,
    pub role: Option<Role>,
    pub event_status: String,
    pub visibility: String,
}

impl Access {
    pub async fn load(db: &PgPool, user: AuthUser, event_id: Uuid) -> AppResult<Self> {
        let row: Option<(String, String, Option<String>)> = sqlx::query_as(
            "select e.status, e.visibility, m.role
             from events e
             left join event_members m on m.event_id = e.id and m.user_id = $2 and m.status = 'active'
             where e.id = $1",
        )
        .bind(event_id)
        .bind(user.id)
        .fetch_optional(db)
        .await?;
        let (event_status, visibility, role) = row.ok_or(AppError::NotFound)?;
        Ok(Self { user, event_id, role: role.as_deref().and_then(Role::parse), event_status, visibility })
    }

    /// Etkinliği yönetebilir: sistem admini veya bu etkinliğin admini.
    pub fn is_admin(&self) -> bool {
        self.user.is_system_admin || self.role == Some(Role::EventAdmin)
    }

    /// Operasyonu yönetebilir: admin veya observer.
    pub fn is_staff(&self) -> bool {
        self.is_admin() || self.role == Some(Role::Observer)
    }

    /// Canlı veriyi görebilir: aktif üye veya sistem admini.
    pub fn is_member(&self) -> bool {
        self.user.is_system_admin || self.role.is_some()
    }

    pub fn admin(self) -> AppResult<Self> {
        if self.is_admin() { Ok(self) } else { Err(self.deny()) }
    }

    pub fn staff(self) -> AppResult<Self> {
        if self.is_staff() { Ok(self) } else { Err(self.deny()) }
    }

    pub fn member(self) -> AppResult<Self> {
        if self.is_member() { Ok(self) } else { Err(self.deny()) }
    }

    pub fn role_is(self, role: Role) -> AppResult<Self> {
        if self.role == Some(role) { Ok(self) } else { Err(self.deny()) }
    }

    /// Özel/taslak etkinliğin varlığını üye olmayana sızdırma.
    fn deny(&self) -> AppError {
        if self.role.is_none() && (self.visibility == "private" || self.event_status == "draft") {
            AppError::NotFound
        } else {
            AppError::Forbidden
        }
    }

    pub fn require_active_event(&self) -> AppResult<()> {
        if self.event_status == "active" { Ok(()) } else { Err(AppError::Conflict("EVENT_NOT_ACTIVE", "event is not active")) }
    }

    /// Kendisi adına mı, yetkili olarak başka bir pilot adına mı? (İkincisi denetim kaydına düşer.)
    pub fn acting_for(&self, target: Option<Uuid>) -> AppResult<(Uuid, bool)> {
        match target {
            Some(t) if t != self.user.id => {
                if self.is_staff() {
                    Ok((t, true))
                } else {
                    Err(AppError::Forbidden)
                }
            }
            _ => Ok((self.user.id, false)),
        }
    }
}
