package tracking

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/mdenizay/retfast/services/api/internal/platform/httpx"
)

func fp(v float64) *float64 { return &v }

func good(now time.Time) SampleIn {
	id := uuid.New()
	seq := int64(1)
	t := httpx.T(now.Add(-time.Minute))
	return SampleIn{ID: &id, Seq: &seq, T: &t, Lat: fp(37.07), Lon: fp(29.34), GPSAltM: fp(2100), HAccM: fp(4.7), SpeedMS: fp(9.8), CourseDeg: fp(212)}
}

func TestValidateSample(t *testing.T) {
	now := time.Now()
	start := now.Add(-30 * time.Minute)
	ended := now.Add(-20 * time.Minute)
	cases := []struct {
		name   string
		mod    func(*SampleIn)
		ended  *time.Time
		reason string
	}{
		{"ok", func(*SampleIn) {}, nil, ""},
		{"lat high", func(s *SampleIn) { s.Lat = fp(90.1) }, nil, ReasonInvalidCoordinates},
		{"lon low", func(s *SampleIn) { s.Lon = fp(-180.5) }, nil, ReasonInvalidCoordinates},
		{"null island", func(s *SampleIn) { s.Lat, s.Lon = fp(0), fp(0) }, nil, ReasonInvalidCoordinates},
		{"missing lat", func(s *SampleIn) { s.Lat = nil }, nil, ReasonInvalidCoordinates},
		{"absurd altitude", func(s *SampleIn) { s.GPSAltM = fp(20000) }, nil, ReasonInvalidCoordinates},
		{"h_acc zero", func(s *SampleIn) { s.HAccM = fp(0) }, nil, ReasonInvalidAccuracy},
		{"h_acc negative", func(s *SampleIn) { s.HAccM = fp(-1) }, nil, ReasonInvalidAccuracy},
		{"h_acc too large", func(s *SampleIn) { s.HAccM = fp(10001) }, nil, ReasonInvalidAccuracy},
		{"h_acc missing", func(s *SampleIn) { s.HAccM = nil }, nil, ReasonInvalidAccuracy},
		{"h_acc 10000 ok", func(s *SampleIn) { s.HAccM = fp(10000) }, nil, ""},
		{"future > 10 min", func(s *SampleIn) { t := httpx.T(now.Add(11 * time.Minute)); s.T = &t }, nil, ReasonTimestampRange},
		{"future 9 min ok", func(s *SampleIn) { t := httpx.T(now.Add(9 * time.Minute)); s.T = &t }, nil, ""},
		{"before start - 1h", func(s *SampleIn) { t := httpx.T(start.Add(-61 * time.Minute)); s.T = &t }, nil, ReasonTimestampRange},
		{"missing t", func(s *SampleIn) { s.T = nil }, nil, ReasonTimestampRange},
		{"after end + 10 min", func(s *SampleIn) {}, &ended, ReasonFlightEnded},
		{"speed too high", func(s *SampleIn) { s.SpeedMS = fp(151) }, nil, ReasonInvalidSpeed},
	}
	for _, c := range cases {
		s := good(now)
		c.mod(&s)
		if got := ValidateSample(&s, now, start, c.ended); got != c.reason {
			t.Errorf("%s: got %q want %q", c.name, got, c.reason)
		}
	}
	// Core Location sentinels are normalised, not rejected
	s := good(now)
	s.SpeedMS, s.CourseDeg, s.VAccM = fp(-1), fp(-1), fp(-1)
	if r := ValidateSample(&s, now, start, nil); r != "" || s.SpeedMS != nil || s.CourseDeg != nil || s.VAccM != nil {
		t.Fatalf("sentinels: %q %v %v %v", r, s.SpeedMS, s.CourseDeg, s.VAccM)
	}
}

func TestValidateStructure(t *testing.T) {
	now := time.Now()
	ok := good(now)
	if err := ValidateStructure(&BatchIn{BatchID: uuid.New(), FlightID: uuid.New(), Samples: []SampleIn{ok}}); err != nil {
		t.Fatal(err)
	}
	bad := []BatchIn{
		{FlightID: uuid.New(), Samples: []SampleIn{ok}},
		{BatchID: uuid.New(), Samples: []SampleIn{ok}},
		{BatchID: uuid.New(), FlightID: uuid.New()},
		{BatchID: uuid.New(), FlightID: uuid.New(), Samples: make([]SampleIn, 501)},
		{BatchID: uuid.New(), FlightID: uuid.New(), Samples: []SampleIn{{Seq: ok.Seq}}},
		{BatchID: uuid.New(), FlightID: uuid.New(), Samples: []SampleIn{{ID: ok.ID}}},
	}
	neg := int64(-1)
	bad = append(bad, BatchIn{BatchID: uuid.New(), FlightID: uuid.New(), Samples: []SampleIn{{ID: ok.ID, Seq: &neg}}})
	for i, b := range bad {
		if ValidateStructure(&b) == nil {
			t.Errorf("case %d accepted", i)
		}
	}
}

func TestPartitionName(t *testing.T) {
	if n := PartitionName(time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)); n != "flight_positions_p202611" {
		t.Fatal(n)
	}
}
