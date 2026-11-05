package retrievals

import "testing"

func TestStateMachine(t *testing.T) {
	all := []string{StatusRequested, StatusAccepted, StatusPickedUp, StatusDelivered, StatusCancelled}
	allowed := map[Action]map[string]string{
		ActAccept:  {StatusRequested: StatusAccepted},
		ActAssign:  {StatusRequested: StatusAccepted, StatusAccepted: StatusAccepted},
		ActRelease: {StatusAccepted: StatusRequested},
		ActPickUp:  {StatusAccepted: StatusPickedUp},
		ActDeliver: {StatusPickedUp: StatusDelivered},
		ActCancel:  {StatusRequested: StatusCancelled, StatusAccepted: StatusCancelled, StatusPickedUp: StatusCancelled},
	}
	for act, ok := range allowed {
		for _, from := range all {
			to, got := Next(from, act)
			want, exp := ok[from]
			if got != exp || (exp && to != want) {
				t.Errorf("%s from %s: got (%s,%v) want (%s,%v)", act, from, to, got, want, exp)
			}
		}
	}
	for _, from := range []string{StatusDelivered, StatusCancelled} {
		if _, ok := Next(from, ActPosition); ok {
			t.Errorf("position accepted on %s", from)
		}
	}
}
