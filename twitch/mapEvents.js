// Translates a raw Twitch EventSub notification into our own
// { type, data } alert shape (see public/shared/alert-types.js).
// Returning null means "don't alert for this one".
function mapEventSubNotification(subscriptionType, event) {
  switch (subscriptionType) {
    case 'channel.follow':
      return { type: 'follow', data: { username: event.user_name } };

    case 'channel.subscribe':
      // Gifted subs also fire channel.subscribe for the recipient; we skip
      // it here and alert once via channel.subscription.gift instead.
      if (event.is_gift) return null;
      return {
        type: 'subscription',
        data: { username: event.user_name, tier: event.tier, isGift: false, months: 1 },
      };

    case 'channel.subscription.gift':
      return {
        type: 'subscription',
        data: {
          username: event.is_anonymous ? 'Anonymous' : event.user_name,
          tier: event.tier,
          isGift: true,
          giftCount: event.total,
        },
      };

    case 'channel.subscription.message':
      // Unlike channel.subscribe, this one only fires when the viewer
      // shared a resub message — event.message is the chat-message shape
      // ({ text, emotes }), not a plain string like channel.cheer's.
      return {
        type: 'subscription',
        data: {
          username: event.user_name,
          tier: event.tier,
          isGift: false,
          months: event.cumulative_months,
          message: event.message && event.message.text ? event.message.text : '',
        },
      };

    case 'channel.cheer':
      return {
        type: 'cheer',
        data: {
          username: event.is_anonymous ? 'Anonymous' : event.user_name,
          bits: event.bits,
          message: event.message,
        },
      };

    case 'channel.raid':
      return {
        type: 'raid',
        data: { username: event.from_broadcaster_user_name, viewers: event.viewers },
      };

    default:
      return null;
  }
}

module.exports = { mapEventSubNotification };
