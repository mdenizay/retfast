<?php

namespace Database\Seeders;

use App\Models\DropOffPoint;
use App\Models\Event;
use App\Models\EventApplication;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        // --- Kullanıcılar ---

        $admin = User::firstOrCreate(
            ['email' => 'admin@retfast.test'],
            [
                'name' => 'Admin',
                'password' => Hash::make('password'),
                'role' => 'admin',
                'is_active' => true,
            ]
        );

        $pilots = [
            ['name' => 'Ahmet Yılmaz',  'email' => 'ahmet@retfast.test',  'phone' => '+90 532 111 0001'],
            ['name' => 'Burak Demir',   'email' => 'burak@retfast.test',  'phone' => '+90 532 111 0002'],
            ['name' => 'Can Arslan',    'email' => 'can@retfast.test',    'phone' => '+90 532 111 0003'],
        ];

        $retrievers = [
            ['name' => 'Deniz Kaya',   'email' => 'deniz@retfast.test',  'phone' => '+90 533 222 0001'],
            ['name' => 'Emre Çelik',   'email' => 'emre@retfast.test',   'phone' => '+90 533 222 0002'],
        ];

        $pilotUsers = [];
        foreach ($pilots as $data) {
            $pilotUsers[] = User::firstOrCreate(
                ['email' => $data['email']],
                [
                    'name' => $data['name'],
                    'phone' => $data['phone'],
                    'password' => Hash::make('password'),
                    'role' => 'pilot',
                    'is_active' => true,
                ]
            );
        }

        $retrieverUsers = [];
        foreach ($retrievers as $data) {
            $retrieverUsers[] = User::firstOrCreate(
                ['email' => $data['email']],
                [
                    'name' => $data['name'],
                    'phone' => $data['phone'],
                    'password' => Hash::make('password'),
                    'role' => 'retriever',
                    'is_active' => true,
                ]
            );
        }

        // --- Etkinlik ---

        $event = Event::firstOrCreate(
            ['name' => 'Denizli XC Open 2026'],
            [
                'description' => 'Denizli Babadağ\'dan başlayan XC yarışması. Türkiye\'nin en prestijli yamaç paraşütü etkinliklerinden biri.',
                'location' => 'Denizli, Babadağ',
                'status' => 'active',
                'start_date' => '2026-06-15 08:00:00',
                'end_date' => '2026-06-25 18:00:00',
                'map_center_lat' => 37.5264,
                'map_center_lng' => 29.1032,
                'map_zoom' => 11,
                'location_update_interval_seconds' => 15,
                'max_pilots' => 30,
                'created_by' => $admin->id,
            ]
        );

        // Bırakma noktaları
        $dropOffs = [
            ['name' => 'Çardak Havalimanı Yanı', 'lat' => 37.7960, 'lng' => 29.7016, 'is_default' => true],
            ['name' => 'Honaz Merkez',           'lat' => 37.7578, 'lng' => 29.2720, 'is_default' => false],
            ['name' => 'Pamukkale Otoparkı',     'lat' => 37.9200, 'lng' => 29.1173, 'is_default' => false],
        ];

        foreach ($dropOffs as $pt) {
            DropOffPoint::firstOrCreate(
                ['event_id' => $event->id, 'name' => $pt['name']],
                ['lat' => $pt['lat'], 'lng' => $pt['lng'], 'is_default' => $pt['is_default']]
            );
        }

        // Pilotları onayla
        foreach ($pilotUsers as $pilot) {
            EventApplication::firstOrCreate(
                ['event_id' => $event->id, 'user_id' => $pilot->id, 'type' => 'pilot'],
                [
                    'status' => 'approved',
                    'notes' => 'Test hesabı',
                    'reviewed_by' => $admin->id,
                    'reviewed_at' => now(),
                ]
            );
        }

        // Retriever'ları onayla
        foreach ($retrieverUsers as $retriever) {
            EventApplication::firstOrCreate(
                ['event_id' => $event->id, 'user_id' => $retriever->id, 'type' => 'retriever'],
                [
                    'status' => 'approved',
                    'vehicle_capacity' => 4,
                    'vehicle_description' => 'Toyota Corolla',
                    'notes' => 'Test hesabı',
                    'reviewed_by' => $admin->id,
                    'reviewed_at' => now(),
                ]
            );
        }
    }
}
