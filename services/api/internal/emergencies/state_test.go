package emergencies

import "testing"

func TestIncidentStateMachine(t *testing.T) {
	allowed := map[[2]string]bool{
		{"open", "acknowledged"}: true, {"open", "responding"}: true, {"open", "resolved"}: true, {"open", "cancelled"}: true,
		{"acknowledged", "responding"}: true, {"acknowledged", "resolved"}: true, {"acknowledged", "cancelled"}: true,
		{"responding", "resolved"}: true, {"responding", "cancelled"}: true,
	}
	all := []string{"open", "acknowledged", "responding", "resolved", "cancelled"}
	for _, from := range all {
		for _, to := range all {
			if from == to {
				continue
			}
			if got := CanTransition(from, to); got != allowed[[2]string{from, to}] {
				t.Errorf("%s → %s: %v", from, to, got)
			}
		}
	}
}

func TestAssignmentStateMachine(t *testing.T) {
	ok := [][2]string{{"assigned", "en_route"}, {"assigned", "on_scene"}, {"en_route", "on_scene"}, {"on_scene", "completed"},
		{"assigned", "withdrawn"}, {"on_scene", "withdrawn"}}
	bad := [][2]string{{"en_route", "assigned"}, {"completed", "withdrawn"}, {"withdrawn", "assigned"}, {"completed", "on_scene"}, {"assigned", "bogus"}}
	for _, c := range ok {
		if !CanTransitionAssignment(c[0], c[1]) {
			t.Errorf("%v should be allowed", c)
		}
	}
	for _, c := range bad {
		if CanTransitionAssignment(c[0], c[1]) {
			t.Errorf("%v should be refused", c)
		}
	}
}
