from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User

@admin.register(User)
class OnConnectUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("OnConnect profile", {"fields": ("display_name", "bio", "avatar_url")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Profile", {"fields": ("email", "display_name")}),
    )
    list_display = ("username", "email", "display_name", "is_staff", "is_active")
    search_fields = ("username", "email", "display_name")
