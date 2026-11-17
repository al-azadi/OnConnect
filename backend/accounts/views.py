import uuid

from django.conf import settings
from django.contrib.auth import login, logout
from django.core.files.storage import default_storage
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from .serializers import (
    LoginSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)

@ensure_csrf_cookie
def csrf_token(request):
    return JsonResponse({"csrfToken": get_token(request)})

class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response({"user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        return Response({"user": UserSerializer(user).data})

class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({"detail": "Logged out."})

AVATAR_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


def delete_old_avatar(user):
    """Remove a previously uploaded avatar file (never touches external URLs)."""
    prefix = f"{settings.MEDIA_URL}avatars/"
    if user.avatar_url and user.avatar_url.startswith(prefix):
        relative_path = user.avatar_url[len(settings.MEDIA_URL):]
        try:
            default_storage.delete(relative_path)
        except Exception:
            pass


class MeView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        return Response({"user": UserSerializer(request.user).data})

    def patch(self, request):
        serializer = ProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = request.user

        if "display_name" in data:
            user.display_name = data["display_name"].strip() or user.username
        if "bio" in data:
            user.bio = data["bio"].strip()

        avatar = data.get("avatar")
        if avatar or data.get("remove_avatar"):
            delete_old_avatar(user)
            user.avatar_url = ""

        if avatar:
            extension = AVATAR_EXTENSIONS[avatar.image.format]
            name = default_storage.save(f"avatars/{user.id}/{uuid.uuid4().hex}{extension}", avatar)
            user.avatar_url = f"{settings.MEDIA_URL}{name}"

        user.save()
        return Response({"user": UserSerializer(user).data})
