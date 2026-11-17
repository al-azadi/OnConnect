from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Community(models.Model):
    PUBLIC = "public"
    PRIVATE = "private"

    VISIBILITY_CHOICES = [
        (PUBLIC, "Public"),
        (PRIVATE, "Private"),
    ]

    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(max_length=2000, blank=True)
    rules = models.TextField(max_length=5000, blank=True)

    visibility = models.CharField(
        max_length=10,
        choices=VISIBILITY_CHOICES,
        default=PUBLIC,
    )

    image_url = models.URLField(blank=True)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_communities",
    )

    member_limit = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:80] or "community"
            candidate = base
            number = 2

            while Community.objects.filter(
                slug=candidate
            ).exclude(pk=self.pk).exists():
                candidate = f"{base}-{number}"
                number += 1

            self.slug = candidate

        super().save(*args, **kwargs)

    @property
    def active_member_count(self):
        return self.memberships.filter(
            status=Membership.ACTIVE
        ).count()

    def __str__(self):
        return self.name


class Membership(models.Model):
    OWNER = "owner"
    ADMIN = "admin"
    MODERATOR = "moderator"
    MEMBER = "member"

    ROLE_CHOICES = [
        (OWNER, "Owner"),
        (ADMIN, "Administrator"),
        (MODERATOR, "Moderator"),
        (MEMBER, "Member"),
    ]

    ACTIVE = "active"
    PENDING = "pending"

    STATUS_CHOICES = [
        (ACTIVE, "Active"),
        (PENDING, "Pending"),
    ]

    community = models.ForeignKey(
        Community,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_memberships",
    )

    role = models.CharField(
        max_length=12,
        choices=ROLE_CHOICES,
        default=MEMBER,
    )

    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default=ACTIVE,
    )

    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["community", "user"],
                name="unique_community_member",
            )
        ]
        ordering = ["joined_at"]

    def __str__(self):
        return f"{self.user} - {self.community} ({self.role})"
