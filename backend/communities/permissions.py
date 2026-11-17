from .models import Membership


def membership_for(user, community):
    if not user or not user.is_authenticated:
        return None

    return Membership.objects.filter(
        community=community,
        user=user,
        status=Membership.ACTIVE,
    ).first()


def can_moderate(user, community):
    membership = membership_for(user, community)

    return bool(
        membership
        and membership.role in [
            Membership.OWNER,
            Membership.ADMIN,
            Membership.MODERATOR,
        ]
    )


def can_manage(user, community):
    membership = membership_for(user, community)

    return bool(
        membership
        and membership.role in [
            Membership.OWNER,
            Membership.ADMIN,
        ]
    )
