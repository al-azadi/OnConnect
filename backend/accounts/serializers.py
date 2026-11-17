from django.contrib.auth import authenticate, get_user_model, password_validation
from rest_framework import serializers

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "display_name", "bio", "avatar_url", "date_joined", "is_staff")
        read_only_fields = ("id", "date_joined", "is_staff")

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, trim_whitespace=False)

    class Meta:
        model = User
        fields = ("username", "email", "display_name", "password")

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
        )
        if user is None or not user.is_active:
            raise serializers.ValidationError("Invalid username or password.")
        attrs["user"] = user
        return attrs


ALLOWED_AVATAR_FORMATS = ("JPEG", "PNG", "WEBP")
MAX_AVATAR_BYTES = 5 * 1024 * 1024


class ProfileUpdateSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    bio = serializers.CharField(max_length=280, required=False, allow_blank=True)
    avatar = serializers.ImageField(required=False, allow_null=True)
    remove_avatar = serializers.BooleanField(required=False)

    def validate_avatar(self, value):
        if value is None:
            return value
        if value.size > MAX_AVATAR_BYTES:
            raise serializers.ValidationError("Profile pictures must be 5 MB or smaller.")
        image_format = getattr(getattr(value, "image", None), "format", None)
        if image_format not in ALLOWED_AVATAR_FORMATS:
            raise serializers.ValidationError("Only JPEG, PNG and WEBP images are allowed.")
        return value
