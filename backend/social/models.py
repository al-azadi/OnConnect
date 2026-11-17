from django.conf import settings
from django.db import models
from communities.models import Community


def post_image_path(instance, filename):
    return f"posts/{instance.post_id}/{filename}"


def branding_image_path(instance, filename):
    return f"branding/{filename}"


class Post(models.Model):
    TEXT = "text"
    LINK = "link"
    POST_TYPES = [(TEXT, "Text"), (LINK, "Link")]

    community = models.ForeignKey(
        Community, on_delete=models.CASCADE, related_name="posts"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_posts",
    )
    post_type = models.CharField(max_length=8, choices=POST_TYPES, default=TEXT)
    title = models.CharField(max_length=180)
    body = models.TextField(max_length=20000, blank=True)
    link_url = models.URLField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["community", "-created_at"])]

    def __str__(self):
        return self.title


class Comment(models.Model):
    post = models.ForeignKey(
        Post, on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_comments",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    body = models.TextField(max_length=5000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment by {self.author}"


class Vote(models.Model):
    UP = 1
    DOWN = -1
    VALUE_CHOICES = [(UP, "Upvote"), (DOWN, "Downvote")]

    post = models.ForeignKey(
        Post, on_delete=models.CASCADE, related_name="votes"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="post_votes",
    )
    value = models.SmallIntegerField(choices=VALUE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["post", "user"],
                name="unique_user_post_vote",
            )
        ]


class PostImage(models.Model):
    post = models.ForeignKey(
        Post,
        on_delete=models.CASCADE,
        related_name="images",
    )
    image = models.ImageField(upload_to=post_image_path)
    caption = models.CharField(max_length=250, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self):
        return f"Image for post {self.post_id}"


class SiteBranding(models.Model):
    site_name = models.CharField(
        max_length=100,
        default="OnConnect",
    )
    tagline = models.CharField(
        max_length=200,
        default="Research • Develop • Connect",
    )
    logo = models.ImageField(
    upload_to=branding_image_path,
    blank=True,
    null=True,
    )
    app_icon = models.ImageField(
        upload_to=branding_image_path,
        blank=True,
        null=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Platform Branding"
        verbose_name_plural = "Platform Branding"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.site_name
