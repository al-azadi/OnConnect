from django.urls import path

from .views import (
    PostListCreateView,
    PostDetailView,
    CommentListCreateView,
    CommentDetailView,
    VoteView,
    VoteDeleteView,
    PostImageListCreateView,
    PostImageDeleteView,
    SiteBrandingView,
)

urlpatterns = [
    path("posts/", PostListCreateView.as_view()),
    path("posts/<int:pk>/", PostDetailView.as_view()),

    path(
        "posts/<int:post_id>/comments/",
        CommentListCreateView.as_view(),
    ),

    path(
        "comments/<int:pk>/",
        CommentDetailView.as_view(),
    ),

    path(
        "posts/<int:post_id>/vote/",
        VoteView.as_view(),
    ),

    path(
        "posts/<int:post_id>/vote/remove/",
        VoteDeleteView.as_view(),
    ),

    path(
        "posts/<int:post_id>/images/",
        PostImageListCreateView.as_view(),
    ),

    path(
        "posts/<int:post_id>/images/<int:image_id>/",
        PostImageDeleteView.as_view(),
    ),

    path(
        "branding/",
        SiteBrandingView.as_view(),
    ),
]
