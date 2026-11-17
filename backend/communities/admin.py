from django.contrib import admin

from .models import Community, Membership


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0


@admin.register(Community)
class CommunityAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "owner",
        "visibility",
        "member_limit",
        "created_at",
    )

    search_fields = ("name", "slug", "owner__username")
    inlines = [MembershipInline]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = (
        "community",
        "user",
        "role",
        "status",
        "joined_at",
    )

    list_filter = ("role", "status")
    search_fields = ("community__name", "user__username")
