from rest_framework import serializers
from .models import Community, Membership


class CommunitySerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(
        source="owner.display_name",
        read_only=True,
    )

    member_count = serializers.IntegerField(
        source="active_member_count",
        read_only=True,
    )

    my_role = serializers.SerializerMethodField()
    is_member = serializers.SerializerMethodField()

    class Meta:
        model = Community
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "rules",
            "visibility",
            "image_url",
            "owner",
            "owner_name",
            "member_limit",
            "member_count",
            "my_role",
            "is_member",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "slug",
            "owner",
            "owner_name",
            "member_count",
            "my_role",
            "is_member",
            "created_at",
            "updated_at",
        ]

    def get_my_role(self, obj):
        request = self.context.get("request")

        if not request or not request.user.is_authenticated:
            return None

        membership = Membership.objects.filter(
            community=obj,
            user=request.user,
            status=Membership.ACTIVE,
        ).first()

        return membership.role if membership else None

    def get_is_member(self, obj):
        return self.get_my_role(obj) is not None

    def validate_member_limit(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError(
                "Member limit must be at least 1."
            )

        return value
