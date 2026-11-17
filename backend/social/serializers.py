from rest_framework import serializers

from PIL import Image

from .models import Post, PostImage, Comment, Vote, SiteBranding


MAX_IMAGE_SIZE = 5 * 1024 * 1024


def validate_uploaded_image(image):
    if image.size > MAX_IMAGE_SIZE:
        raise serializers.ValidationError(
            "Image size cannot exceed 5 MB."
        )

    try:
        img = Image.open(image)
        img.verify()

        if img.format not in ["JPEG", "PNG", "WEBP"]:
            raise serializers.ValidationError(
                "Only JPEG, PNG and WEBP images are allowed."
            )

    except serializers.ValidationError:
        raise

    except Exception:
        raise serializers.ValidationError(
            "The uploaded file is not a valid image."
        )

    image.seek(0)
    return image


class PostImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = PostImage
        fields = [
            "id",
            "image",
            "image_url",
            "caption",
            "uploaded_at",
        ]
        read_only_fields = [
            "id",
            "image_url",
            "uploaded_at",
        ]

    def validate_image(self, image):
        return validate_uploaded_image(image)

    def get_image_url(self, obj):
        if not obj.image:
            return None

        request = self.context.get("request")
        url = obj.image.url

        return request.build_absolute_uri(url) if request else url


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(
        source="author.display_name",
        read_only=True,
    )

    username = serializers.CharField(
        source="author.username",
        read_only=True,
    )

    author_avatar = serializers.CharField(
        source="author.avatar_url",
        read_only=True,
    )

    class Meta:
        model = Comment
        fields = [
            "id",
            "post",
            "author",
            "author_name",
            "username",
            "author_avatar",
            "parent",
            "body",
            "created_at",
        ]

        read_only_fields = [
            "id",
            "post",
            "author",
            "author_name",
            "username",
            "created_at",
        ]


class PostSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(
        source="author.display_name",
        read_only=True,
    )

    username = serializers.CharField(
        source="author.username",
        read_only=True,
    )

    community_name = serializers.CharField(
        source="community.name",
        read_only=True,
    )

    author_avatar = serializers.CharField(
        source="author.avatar_url",
        read_only=True,
    )

    score = serializers.SerializerMethodField()
    comment_count = serializers.IntegerField(read_only=True)
    my_vote = serializers.SerializerMethodField()

    images = PostImageSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Post
        fields = [
            "id",
            "community",
            "community_name",
            "author",
            "author_name",
            "username",
            "author_avatar",
            "post_type",
            "title",
            "body",
            "link_url",
            "images",
            "score",
            "comment_count",
            "my_vote",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "author",
            "author_name",
            "username",
            "community_name",
            "images",
            "score",
            "comment_count",
            "my_vote",
            "created_at",
            "updated_at",
        ]

    def get_score(self, obj):
        return sum(vote.value for vote in obj.votes.all())

    def get_my_vote(self, obj):
        request = self.context.get("request")

        if request and request.user.is_authenticated:
            vote = obj.votes.filter(user=request.user).first()
            return vote.value if vote else 0

        return 0

    def validate(self, attrs):
        post_type = attrs.get(
            "post_type",
            getattr(self.instance, "post_type", Post.TEXT),
        )

        body = attrs.get(
            "body",
            getattr(self.instance, "body", ""),
        )

        link_url = attrs.get(
            "link_url",
            getattr(self.instance, "link_url", ""),
        )

        if post_type == Post.TEXT and not body.strip():
            raise serializers.ValidationError({
                "body": "Text posts need a body."
            })

        if post_type == Post.LINK and not link_url:
            raise serializers.ValidationError({
                "link_url": "Link posts need a URL."
            })

        return attrs


class VoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vote
        fields = ["value"]

    def validate_value(self, value):
        if value not in (Vote.UP, Vote.DOWN):
            raise serializers.ValidationError(
                "Vote must be 1 (upvote) or -1 (downvote)."
            )

        return value


class SiteBrandingSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    app_icon_url = serializers.SerializerMethodField()

    class Meta:
        model = SiteBranding
        fields = [
            "site_name",
            "tagline",
            "logo",
            "logo_url",
            "app_icon",
            "app_icon_url",
            "updated_at",
        ]

        read_only_fields = [
            "logo_url",
            "app_icon_url",
            "updated_at",
        ]

    def validate_logo(self, image):
        return validate_uploaded_image(image)

    def validate_app_icon(self, image):
        return validate_uploaded_image(image)

    def get_logo_url(self, obj):
        if not obj.logo:
            return None

        request = self.context.get("request")
        url = obj.logo.url
        return request.build_absolute_uri(url) if request else url

    def get_app_icon_url(self, obj):
        if not obj.app_icon:
            return None

        request = self.context.get("request")
        url = obj.app_icon.url
        return request.build_absolute_uri(url) if request else url
