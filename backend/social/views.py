from django.db import transaction
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Sum, OuterRef, Subquery, IntegerField
from django.db.models.functions import Coalesce
from .models import PostImage, SiteBranding
from .serializers import (
    PostImageSerializer,
    SiteBrandingSerializer,
)
from django.db.models import Q, Count
from django.shortcuts import get_object_or_404

from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from communities.models import Community, Membership
from communities.permissions import membership_for, can_moderate

from .models import Post, Comment, Vote
from .serializers import (
    PostSerializer,
    CommentSerializer,
    VoteSerializer,
)


def visible_posts(user):
    queryset = (
        Post.objects
        .select_related("author", "community")
        .prefetch_related("votes")
        .annotate(comment_count=Count("comments"))
    )

    if user.is_authenticated:
        return queryset.filter(
            Q(community__visibility=Community.PUBLIC)
            | Q(
                community__memberships__user=user,
                community__memberships__status=Membership.ACTIVE,
            )
        ).distinct()

    return queryset.filter(
        community__visibility=Community.PUBLIC
    )


class PostListCreateView(generics.ListCreateAPIView):
    serializer_class = PostSerializer
    permission_classes = [
        permissions.IsAuthenticatedOrReadOnly
    ]

    def get_queryset(self):
        queryset = visible_posts(self.request.user)

        community_slug = self.request.query_params.get("community")

        if community_slug:
            queryset = queryset.filter(
                community__slug=community_slug
            )

        search = self.request.query_params.get("search", "").strip()

        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(body__icontains=search)
            )

        if self.request.query_params.get("sort") == "top":
            vote_totals = (
                Vote.objects
                .filter(post_id=OuterRef("pk"))
                .values("post_id")
                .annotate(total=Sum("value"))
                .values("total")[:1]
            )

            queryset = queryset.annotate(
                vote_score=Coalesce(
                    Subquery(vote_totals, output_field=IntegerField()),
                    0,
                )
            ).order_by("-vote_score", "-created_at")

        return queryset

    def create(self, request, *args, **kwargs):
        community = get_object_or_404(
            Community,
            id=request.data.get("community"),
        )

        if not membership_for(request.user, community):
            return Response(
                {"detail": "Join this community before posting."},
                status=403,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        serializer.save(
            author=request.user,
            community=community,
        )

        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
        )


class PostDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PostSerializer
    permission_classes = [
        permissions.IsAuthenticatedOrReadOnly
    ]

    def get_queryset(self):
        return visible_posts(self.request.user)

    def update(self, request, *args, **kwargs):
        post = self.get_object()

        if (
            post.author_id != request.user.id
            and not can_moderate(request.user, post.community)
        ):
            return Response(
                {"detail": "You cannot edit this post."},
                status=403,
            )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        post = self.get_object()

        if (
            post.author_id != request.user.id
            and not can_moderate(request.user, post.community)
        ):
            return Response(
                {"detail": "You cannot delete this post."},
                status=403,
            )

        return super().destroy(request, *args, **kwargs)


class CommentListCreateView(generics.ListCreateAPIView):
    serializer_class = CommentSerializer
    permission_classes = [
        permissions.IsAuthenticatedOrReadOnly
    ]

    def get_queryset(self):
        post = get_object_or_404(
            visible_posts(self.request.user),
            id=self.kwargs["post_id"],
        )

        return Comment.objects.filter(
            post=post
        ).select_related("author")

    def create(self, request, *args, **kwargs):
        post = get_object_or_404(
            visible_posts(request.user),
            id=kwargs["post_id"],
        )

        if not membership_for(request.user, post.community):
            return Response(
                {"detail": "Join this community before commenting."},
                status=403,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        parent = None
        parent_id = request.data.get("parent")

        if parent_id:
            parent = get_object_or_404(
                Comment,
                id=parent_id,
                post=post,
            )

        serializer.save(
            author=request.user,
            post=post,
            parent=parent,
        )

        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
        )


class CommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Comment.objects.filter(
            post__in=visible_posts(self.request.user)
        ).select_related("post", "author")

    def update(self, request, *args, **kwargs):
        comment = self.get_object()

        if (
            comment.author_id != request.user.id
            and not can_moderate(
                request.user,
                comment.post.community,
            )
        ):
            return Response(
                {"detail": "You cannot edit this comment."},
                status=403,
            )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        comment = self.get_object()

        if (
            comment.author_id != request.user.id
            and not can_moderate(
                request.user,
                comment.post.community,
            )
        ):
            return Response(
                {"detail": "You cannot delete this comment."},
                status=403,
            )

        return super().destroy(request, *args, **kwargs)


class VoteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, post_id):
        post = get_object_or_404(
            visible_posts(request.user),
            id=post_id,
        )

        if not membership_for(request.user, post.community):
            return Response(
                {"detail": "Join this community before voting."},
                status=403,
            )

        serializer = VoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        value = serializer.validated_data["value"]

        vote = Vote.objects.filter(
            post=post,
            user=request.user,
        ).first()

        if vote and vote.value == value:
            vote.delete()
            value = 0
        elif vote:
            vote.value = value
            vote.save(update_fields=["value", "updated_at"])
        else:
            Vote.objects.create(
                post=post,
                user=request.user,
                value=value,
            )

        score = sum(v.value for v in post.votes.all())

        return Response({
            "my_vote": value,
            "score": score,
        })


class VoteDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, post_id):
        post = get_object_or_404(
            visible_posts(request.user),
            id=post_id,
        )

        Vote.objects.filter(
            post=post,
            user=request.user,
        ).delete()

        score = sum(v.value for v in post.votes.all())

        return Response({
            "my_vote": 0,
            "score": score,
        })


class PostImageListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_post(self, request, post_id):
        return get_object_or_404(
            visible_posts(request.user),
            id=post_id,
        )

    def get(self, request, post_id):
        post = self.get_post(request, post_id)

        serializer = PostImageSerializer(
            post.images.all(),
            many=True,
            context={"request": request},
        )

        return Response(serializer.data)

    def post(self, request, post_id):
        post = self.get_post(request, post_id)

        if not membership_for(request.user, post.community):
            return Response(
                {"detail": "Join this community before uploading images."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if (
            post.author_id != request.user.id
            and not can_moderate(request.user, post.community)
        ):
            return Response(
                {"detail": "Only the post author or a moderator can add images."},
                status=status.HTTP_403_FORBIDDEN,
            )

        files = request.FILES.getlist("images")

        if not files:
            return Response(
                {"detail": "Select at least one image using the 'images' field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(files) > 10:
            return Response(
                {"detail": "You can upload a maximum of 10 images at once."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_images = []

        with transaction.atomic():
            for image in files:
                serializer = PostImageSerializer(
                    data={
                        "image": image,
                        "caption": request.data.get("caption", ""),
                    },
                    context={"request": request},
                )

                serializer.is_valid(raise_exception=True)
                created_images.append(
                    serializer.save(post=post)
                )

        result = PostImageSerializer(
            created_images,
            many=True,
            context={"request": request},
        )

        return Response(
            result.data,
            status=status.HTTP_201_CREATED,
        )


class PostImageDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, post_id, image_id):
        post = get_object_or_404(
            visible_posts(request.user),
            id=post_id,
        )

        if (
            post.author_id != request.user.id
            and not can_moderate(request.user, post.community)
        ):
            return Response(
                {"detail": "You cannot delete images from this post."},
                status=status.HTTP_403_FORBIDDEN,
            )

        image = get_object_or_404(
            PostImage,
            id=image_id,
            post=post,
        )

        if image.image:
            image.image.delete(save=False)

        image.delete()

        return Response(
            {"detail": "Image deleted successfully."},
            status=status.HTTP_200_OK,
        )


class SiteBrandingView(APIView):
    def get_permissions(self):
        if self.request.method in ["PUT", "PATCH"]:
            return [permissions.IsAdminUser()]

        return [permissions.AllowAny()]

    parser_classes = [MultiPartParser, FormParser]

    def get_object(self):
        branding, created = SiteBranding.objects.get_or_create(
            pk=1,
            defaults={
                "site_name": "OnConnect",
                "tagline": "Research • Develop • Connect",
            },
        )

        return branding

    def get(self, request):
        branding = self.get_object()

        serializer = SiteBrandingSerializer(
            branding,
            context={"request": request},
        )

        return Response(serializer.data)

    def put(self, request):
        return self.update_branding(request)

    def patch(self, request):
        return self.update_branding(request)

    def update_branding(self, request):
        branding = self.get_object()

        serializer = SiteBrandingSerializer(
            branding,
            data=request.data,
            partial=True,
            context={"request": request},
        )

        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)
