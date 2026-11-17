from django.contrib import admin
from .models import Post, PostImage, Comment, Vote, SiteBranding


class PostImageInline(admin.TabularInline):
    model = PostImage
    extra = 0


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = (
        "id", "title", "community", "author", "post_type", "created_at"
    )
    list_filter = ("post_type", "created_at")
    search_fields = ("title", "body", "author__username")
    inlines = [PostImageInline]


@admin.register(PostImage)
class PostImageAdmin(admin.ModelAdmin):
    list_display = ("id", "post", "caption", "uploaded_at")
    search_fields = ("post__title", "caption")


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("id", "post", "author", "created_at")
    search_fields = ("body", "author__username")


@admin.register(Vote)
class VoteAdmin(admin.ModelAdmin):
    list_display = ("id", "post", "user", "value", "created_at")


@admin.register(SiteBranding)
class SiteBrandingAdmin(admin.ModelAdmin):
    list_display = ("site_name", "tagline", "updated_at")

    def has_add_permission(self, request):
        return not SiteBranding.objects.exists()
